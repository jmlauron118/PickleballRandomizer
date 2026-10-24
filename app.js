const STORAGE_KEY = "rally-pickleball-state";
const THEME_KEY = "rally-theme";
const COLORS = ["#eaf1df", "#edf0ff", "#fff0e9", "#e7f4f1", "#f7ecdc", "#f4e9f2"];

const playerList = document.querySelector("#player-list");
const courtGrid = document.querySelector("#court-grid");
const notice = document.querySelector("#notice");
const editDialog = document.querySelector("#edit-dialog");
let noticeTimeout;

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readSavedState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  try {
    const value = JSON.parse(saved);
    if (!value || !Array.isArray(value.players) || !Array.isArray(value.courts)) {
      throw new TypeError("Saved Rally data has an invalid shape.");
    }
    return value;
  } catch (error) {
    console.error("Could not load saved Rally data.", error);
    return null;
  }
}

const savedState = readSavedState();
const state = {
  players: savedState?.players?.filter((player) => player && typeof player.id === "string" && typeof player.name === "string").map((player) => ({
    id: player.id,
    name: player.name,
    wins: Number.isInteger(player.wins) && player.wins > 0 ? player.wins : 0,
    losses: Number.isInteger(player.losses) && player.losses > 0 ? player.losses : 0
  })) ?? [],
  format: savedState?.format === "singles" ? "singles" : "doubles",
  courts: savedState?.courts?.filter((court) => court && typeof court.id === "string").map((court) => ({
    id: court.id,
    round: Number.isInteger(court.round) && court.round > 0 ? court.round : 0,
    playerIds: Array.isArray(court.playerIds) ? court.playerIds.filter((id) => typeof id === "string") : [],
    winner: court.winner === "team-a" || court.winner === "team-b" ? court.winner : null
  })) ?? []
};

if (state.courts.length === 0) {
  state.courts = [createCourt(), createCourt()];
}

function createCourt() {
  return { id: makeId(), round: 0, playerIds: [] };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Could not save Rally data.", error);
    showNotice("Your changes could not be saved in this browser.");
  }
}

function showNotice(message) {
  window.clearTimeout(noticeTimeout);
  notice.textContent = message;
  if (message) {
    noticeTimeout = window.setTimeout(() => { notice.textContent = ""; }, 5000);
  }
}

function getPreferredTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === "dark" || savedTheme === "light") {
    return savedTheme;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);

  const button = document.querySelector("#theme-toggle");
  if (!button) return;
  const isDark = theme === "dark";
  button.setAttribute("aria-pressed", String(isDark));
  button.querySelector("span[aria-hidden='true']").textContent = isDark ? "☀" : "☾";
  button.querySelector(".theme-toggle-text").textContent = isDark ? "Light mode" : "Dark mode";
}

function toggleTheme() {
  const nextTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
}

function playerInitials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function playerById(id) {
  return state.players.find((player) => player.id === id);
}

function rankPlayers(players) {
  const rankedPlayers = [...players].sort((a, b) => {
    const aGames = Math.max(1, a.wins + a.losses);
    const bGames = Math.max(1, b.wins + b.losses);
    return b.wins * aGames - a.wins * bGames
      || b.wins - a.wins
      || a.losses - b.losses
      || a.name.localeCompare(b.name);
  });

  let currentRank = 0;
  return rankedPlayers.map((player, index) => {
    const previous = rankedPlayers[index - 1];
    const tied = previous
      && player.wins * Math.max(1, previous.wins + previous.losses) === previous.wins * Math.max(1, player.wins + player.losses)
      && player.wins === previous.wins
      && player.losses === previous.losses;
    if (!tied) currentRank = index + 1;
    return { ...player, rank: currentRank };
  });
}

function renderPlayers() {
  playerList.replaceChildren();
  rankPlayers(state.players).forEach((player, index) => {
    const item = document.createElement("li");
    item.className = "player-row";

    const rank = document.createElement("span");
    rank.className = "player-rank";
    rank.textContent = player.rank;
    rank.setAttribute("aria-label", `Rank ${player.rank}`);

    const avatar = document.createElement("span");
    avatar.className = "player-avatar";
    avatar.textContent = playerInitials(player.name);
    avatar.style.backgroundColor = COLORS[index % COLORS.length];

    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.name;

    const record = document.createElement("span");
    record.className = "player-record";
    record.textContent = `W ${player.wins} · L ${player.losses}`;
    record.setAttribute("aria-label", `${player.wins} wins, ${player.losses} losses`);

    const actions = document.createElement("span");
    actions.className = "row-actions";

    const edit = document.createElement("button");
    edit.className = "icon-button";
    edit.type = "button";
    edit.setAttribute("aria-label", `Edit ${player.name}`);
    edit.title = "Edit player";
    edit.textContent = "✎";
    edit.addEventListener("click", () => openEditDialog(player));

    const remove = document.createElement("button");
    remove.className = "icon-button delete-player";
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${player.name}`);
    remove.title = "Remove player";
    remove.textContent = "×";
    remove.addEventListener("click", () => removePlayer(player.id));

    actions.append(edit, remove);
    item.append(rank, avatar, name, record, actions);
    playerList.append(item);
  });

  const activeIds = new Set(state.courts.flatMap((court) => court.playerIds));
  const availableCount = state.players.filter((player) => !activeIds.has(player.id)).length;
  document.querySelector("#player-count").textContent = state.players.length;
  document.querySelector("#empty-roster").hidden = state.players.length > 0;
  document.querySelector("#clear-players").hidden = state.players.length === 0;
  document.querySelector("#available-summary").textContent = `${availableCount} ${availableCount === 1 ? "player" : "players"} ready`;

  const stack = document.querySelector("#avatar-stack");
  stack.replaceChildren();
  state.players.slice(0, 3).forEach((player, index) => {
    const avatar = document.createElement("span");
    avatar.className = "player-avatar";
    avatar.textContent = playerInitials(player.name);
    avatar.style.backgroundColor = COLORS[index % COLORS.length];
    stack.append(avatar);
  });
}

function renderCourts() {
  courtGrid.replaceChildren();
  const teamSize = state.format === "singles" ? 1 : 2;
  const playersPerCourt = teamSize * 2;

  state.courts.forEach((court, index) => {
    const card = document.createElement("article");
    card.className = `court-card${court.playerIds.length === playersPerCourt ? " has-match" : ""}`;

    const head = document.createElement("div");
    head.className = "court-card-head";
    const title = document.createElement("span");
    title.className = "court-title";
    const number = document.createElement("span");
    number.className = "court-number";
    number.textContent = index + 1;
    title.append(number, document.createTextNode(`Court ${index + 1}`));
    const round = document.createElement("span");
    round.className = "court-round";
    round.textContent = court.round ? `GAME ${String(court.round).padStart(2, "0")}` : "READY";
    head.append(title, round);

    const body = document.createElement("div");
    body.className = "court-card-body";
    const assignedPlayers = court.playerIds.map(playerById).filter(Boolean);
    if (assignedPlayers.length === playersPerCourt) {
      const match = document.createElement("div");
      match.className = "match-row";
      match.append(makeTeam(assignedPlayers.slice(0, teamSize), "team-a"), makeVs(), makeTeam(assignedPlayers.slice(teamSize), "team-b"));
      body.append(match);

      const winnerControl = document.createElement("div");
      winnerControl.className = "winner-control";
      const winnerLabel = document.createElement("span");
      winnerLabel.className = "winner-label";
      winnerLabel.textContent = court.winner ? "CHANGE WINNER" : "TAG WINNER";
      const winnerActions = document.createElement("div");
      winnerActions.className = "winner-actions";
      ["team-a", "team-b"].forEach((team) => {
        const winnerButton = document.createElement("button");
        winnerButton.className = `winner-button${court.winner === team ? " is-selected" : ""}`;
        winnerButton.type = "button";
        winnerButton.textContent = `${team === "team-a" ? "Team A" : "Team B"} won`;
        winnerButton.setAttribute("aria-pressed", String(court.winner === team));
        winnerButton.addEventListener("click", () => recordWinner(court.id, team));
        winnerActions.append(winnerButton);
      });
      winnerControl.append(winnerLabel, winnerActions);
      body.append(winnerControl);
    } else {
      const empty = document.createElement("div");
      empty.className = "court-empty";
      const message = document.createElement("strong");
      message.textContent = "Ready for a new game";
      const detail = document.createElement("span");
      detail.textContent = `${playersPerCourt} players needed`;
      empty.append(message, detail);
      body.append(empty);
    }

    const foot = document.createElement("div");
    foot.className = "court-card-foot";
    const status = document.createElement("span");
    status.className = "court-status";
    const dot = document.createElement("span");
    dot.className = "status-dot";
    const statusText = court.winner
      ? `${court.winner === "team-a" ? "Team A" : "Team B"} won`
      : court.playerIds.length === playersPerCourt ? "In play" : "Waiting";
    status.append(dot, document.createTextNode(statusText));
    const next = document.createElement("button");
    next.className = "next-game";
    next.type = "button";
    next.textContent = court.playerIds.length === playersPerCourt ? "Next game ↗" : "Randomize ↗";
    next.addEventListener("click", () => randomizeCourt(court.id));
    const reset = document.createElement("button");
    reset.className = "reset-court";
    reset.type = "button";
    reset.textContent = "Reset";
    reset.disabled = court.round === 0 && court.playerIds.length === 0;
    reset.setAttribute("aria-label", `Reset Court ${index + 1}`);
    reset.addEventListener("click", () => resetCourt(court.id));
    const actions = document.createElement("span");
    actions.className = "court-actions";
    actions.append(reset, next);
    foot.append(status, actions);
    card.append(head, body, foot);
    courtGrid.append(card);
  });

  document.querySelector("#court-count").textContent = state.courts.length;
  document.querySelector("#remove-court").disabled = state.courts.length <= 1;
  const amount = state.format === "singles" ? 2 : 4;
  document.querySelector("#setup-hint-text").textContent = `Add at least ${amount} players to fill a ${state.format === "singles" ? "singles" : "doubles"} court.`;
  document.querySelectorAll(".format-option").forEach((button) => {
    const selected = button.dataset.format === state.format;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function makeTeam(players, className) {
  const team = document.createElement("div");
  team.className = `team ${className}`;
  players.forEach((player) => {
    const entry = document.createElement("div");
    entry.className = "team-player";
    const avatar = document.createElement("span");
    avatar.className = "mini-avatar";
    avatar.textContent = playerInitials(player.name);
    const name = document.createElement("span");
    name.textContent = player.name;
    entry.append(avatar, name);
    team.append(entry);
  });
  return team;
}

function makeVs() {
  const label = document.createElement("span");
  label.className = "vs";
  label.textContent = "VS";
  return label;
}

function adjustCourtRecord(court, winner, amount) {
  const teamSize = state.format === "singles" ? 1 : 2;
  court.playerIds.forEach((playerId, index) => {
    const player = playerById(playerId);
    if (!player) return;
    const playerWon = (index < teamSize) === (winner === "team-a");
    const result = playerWon ? "wins" : "losses";
    player[result] = Math.max(0, player[result] + amount);
  });
}

function recordWinner(courtId, winner) {
  const court = state.courts.find((item) => item.id === courtId);
  const playersPerCourt = state.format === "singles" ? 2 : 4;
  if (!court || (winner !== "team-a" && winner !== "team-b") || court.playerIds.length !== playersPerCourt) return;
  if (court.winner === winner) return;

  if (court.winner) adjustCourtRecord(court, court.winner, -1);
  adjustCourtRecord(court, winner, 1);
  court.winner = winner;
  saveState();
  render();
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function randomizeCourt(courtId) {
  const court = state.courts.find((item) => item.id === courtId);
  if (!court) return;
  const busy = new Set(state.courts.filter((item) => item.id !== courtId).flatMap((item) => item.playerIds));
  const amount = state.format === "singles" ? 2 : 4;
  const previousPlayers = new Set(court.playerIds);
  const available = state.players.filter((player) => !busy.has(player.id));
  const restedPlayers = available.filter((player) => !previousPlayers.has(player.id));
  const returningPlayers = available.filter((player) => previousPlayers.has(player.id));
  if (available.length < amount) {
    showNotice(`Court ${state.courts.indexOf(court) + 1} needs ${amount} available players; ${available.length} ${available.length === 1 ? "is" : "are"} free.`);
    return;
  }
  const selectedPlayers = [
    ...shuffle(restedPlayers).slice(0, amount),
    ...shuffle(returningPlayers).slice(0, Math.max(0, amount - restedPlayers.length))
  ];
  court.playerIds = shuffle(selectedPlayers).map((player) => player.id);
  court.winner = null;
  court.round += 1;
  showNotice("");
  render();
}

function resetCourt(courtId) {
  const court = state.courts.find((item) => item.id === courtId);
  if (!court) return;
  court.playerIds = [];
  court.round = 0;
  court.winner = null;
  showNotice("");
  saveState();
  render();
}

function randomizeAll() {
  const amount = state.format === "singles" ? 2 : 4;
  let pool = shuffle(state.players);
  let filled = 0;
  state.courts.forEach((court) => {
    court.winner = null;
    court.playerIds = pool.splice(0, amount).map((player) => player.id);
    if (court.playerIds.length === amount) {
      court.round += 1;
      filled += 1;
    } else {
      court.playerIds = [];
    }
  });
  const shortfall = state.courts.length - filled;
  if (shortfall > 0) {
    const additionalPlayers = state.courts.length * amount - state.players.length;
    showNotice(`Not enough players to fill every court. ${filled} ${filled === 1 ? "court was" : "courts were"} randomized; add ${additionalPlayers} more player${additionalPlayers === 1 ? "" : "s"} to fill the rest.`);
  } else {
    showNotice("");
  }
  render();
}

function openEditDialog(player) {
  document.querySelector("#edit-player-id").value = player.id;
  document.querySelector("#edit-player-name").value = player.name;
  editDialog.showModal();
  document.querySelector("#edit-player-name").focus();
}

function removePlayer(playerId) {
  state.players = state.players.filter((player) => player.id !== playerId);
  state.courts.forEach((court) => {
    if (court.playerIds.includes(playerId)) {
      court.playerIds = [];
      court.winner = null;
    }
  });
  saveState();
  render();
}

function render() {
  renderPlayers();
  renderCourts();
}

document.querySelector("#theme-toggle").addEventListener("click", toggleTheme);
applyTheme(getPreferredTheme());

document.querySelector("#add-player-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("#player-name");
  const name = input.value.trim();
  if (!name) return;
  if (state.players.some((player) => player.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    showNotice(`${name} is already on the player list.`);
    input.focus();
    return;
  }
  state.players.push({ id: makeId(), name, wins: 0, losses: 0 });
  input.value = "";
  showNotice("");
  saveState();
  render();
  input.focus();
});

document.querySelector("#edit-player-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = document.querySelector("#edit-player-id").value;
  const name = document.querySelector("#edit-player-name").value.trim();
  const player = playerById(id);
  if (!player || !name) return;
  if (state.players.some((other) => other.id !== id && other.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    showNotice(`${name} is already on the player list.`);
    return;
  }
  player.name = name;
  editDialog.close();
  saveState();
  render();
});

document.querySelector("#cancel-edit").addEventListener("click", () => editDialog.close());
document.querySelector("#clear-players").addEventListener("click", () => {
  state.players = [];
  state.courts.forEach((court) => { court.playerIds = []; });
  saveState();
  render();
});
document.querySelectorAll(".format-option").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.format === state.format) return;
    state.format = button.dataset.format;
    state.courts.forEach((court) => {
      court.playerIds = [];
      court.winner = null;
    });
    showNotice("Format changed. Randomize to create new matchups.");
    saveState();
    render();
  });
});
document.querySelector("#add-court").addEventListener("click", () => {
  state.courts.push(createCourt());
  saveState();
  render();
});
document.querySelector("#remove-court").addEventListener("click", () => {
  if (state.courts.length <= 1) return;
  state.courts.pop();
  saveState();
  render();
});
document.querySelector("#shuffle-all").addEventListener("click", randomizeAll);

document.querySelector("#session-date").textContent = new Intl.DateTimeFormat(undefined, {
  weekday: "short", month: "short", day: "numeric", year: "numeric"
}).format(new Date());

render();
