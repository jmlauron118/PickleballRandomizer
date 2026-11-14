const STORAGE_KEY = "rally-pickleball-state";
const THEME_KEY = "rally-theme";
const COLORS = ["#eaf1df", "#edf0ff", "#fff0e9", "#e7f4f1", "#f7ecdc", "#f4e9f2"];

const playerList = document.querySelector("#player-list");
const courtGrid = document.querySelector("#court-grid");
const notice = document.querySelector("#notice");
const editDialog = document.querySelector("#edit-dialog");
const replaceDialog = document.querySelector("#replace-dialog");
const resultsDialog = document.querySelector("#results-dialog");
const recordDialog = document.querySelector("#record-dialog");
const confirmDialog = document.querySelector("#confirm-dialog");
let noticeTimeout;
let activeRecord = null;
let activeReplacement = null;
let pendingConfirmation = null;

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
const savedMatches = Array.isArray(savedState?.matches) ? savedState.matches : [];
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
    winner: court.winner === "team-a" || court.winner === "team-b" ? court.winner : null,
    matchId: typeof court.matchId === "string" ? court.matchId : null
  })) ?? [],
  matches: savedMatches.filter((match) => match
    && typeof match.id === "string"
    && Number.isInteger(match.number) && match.number > 0
    && (match.winner === "team-a" || match.winner === "team-b")
    && (match.teamSize === 1 || match.teamSize === 2)
    && Array.isArray(match.playerIds) && match.playerIds.every((id) => typeof id === "string")
    && Array.isArray(match.playerNames) && match.playerNames.every((name) => typeof name === "string")
    && match.playerIds.length === match.playerNames.length
    && match.playerIds.length === match.teamSize * 2
    && [11, 15, 21].includes(match.gameTo)
    && Number.isInteger(match.losingScore) && match.losingScore >= 0 && match.losingScore <= 10)
    .map((match) => ({
      id: match.id,
      number: match.number,
      courtId: typeof match.courtId === "string" ? match.courtId : "",
      playerIds: [...match.playerIds],
      playerNames: [...match.playerNames],
      teamSize: match.teamSize,
      winner: match.winner,
      gameTo: match.gameTo,
      losingScore: match.losingScore
    })) ?? [],
  nextMatchNumber: Math.max(
    Number.isInteger(savedState?.nextMatchNumber) && savedState.nextMatchNumber > 0 ? savedState.nextMatchNumber : 1,
    savedMatches.reduce((max, match) => Number.isInteger(match?.number) ? Math.max(max, match.number + 1) : max, 1)
  )
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
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1
    ? words.slice(0, 2).map((word) => Array.from(word)[0])
    : Array.from(words[0] ?? "").slice(0, 2);
  return letters.length ? `${letters[0]}${letters[1] ?? letters[0]}`.toLocaleUpperCase() : "";
}

function playerById(id) {
  return state.players.find((player) => player.id === id);
}

function opponentScoreFor(player) {
  return state.matches.reduce((total, match) => {
    const playerIndex = match.playerIds.indexOf(player.id);
    if (playerIndex < 0) return total;
    const playerWon = (playerIndex < match.teamSize) === (match.winner === "team-a");
    return total + (playerWon ? match.losingScore : match.gameTo);
  }, 0);
}

function rankPlayers(players) {
  const rankedPlayers = players.map((player) => ({
    ...player,
    opponentScore: opponentScoreFor(player)
  })).sort((a, b) => {
    const aGames = Math.max(1, a.wins + a.losses);
    const bGames = Math.max(1, b.wins + b.losses);
    return b.wins * aGames - a.wins * bGames
      || a.opponentScore - b.opponentScore
      || a.name.localeCompare(b.name);
  });

  let currentRank = 0;
  return rankedPlayers.map((player, index) => {
    const previous = rankedPlayers[index - 1];
    const tied = previous
      && player.wins * Math.max(1, previous.wins + previous.losses) === previous.wins * Math.max(1, player.wins + player.losses)
      && player.opponentScore === previous.opponentScore;
    if (!tied) currentRank = index + 1;
    return { ...player, rank: currentRank };
  });
}

function renderPlayers() {
  playerList.replaceChildren();
  state.players.forEach((player, index) => {
    const item = document.createElement("li");
    item.className = "player-row";

    const avatar = document.createElement("span");
    avatar.className = "player-avatar";
    avatar.textContent = playerInitials(player.name);
    avatar.style.backgroundColor = COLORS[index % COLORS.length];

    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.name;

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
    item.append(avatar, name, actions);
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
      match.append(makeTeam(assignedPlayers.slice(0, teamSize), "team-a", court.id, index + 1), makeVs(), makeTeam(assignedPlayers.slice(teamSize), "team-b", court.id, index + 1));
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

function makeMatchActionIcon(pathData) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  svg.append(path);
  return svg;
}

function renderMatchLog() {
  const list = document.querySelector("#match-log-list");
  const empty = document.querySelector("#match-log-empty");
  const query = document.querySelector("#match-search").value.trim().toLocaleLowerCase();
  list.replaceChildren();
  const matches = [...state.matches].reverse().filter((match) => {
    if (!query) return true;
    const searchText = [
      match.number,
      ...match.playerNames,
      match.gameTo,
      match.losingScore,
      `${match.gameTo}-${match.losingScore}`,
      `${match.gameTo}–${match.losingScore}`
    ].join(" ").toLocaleLowerCase();
    return searchText.includes(query);
  });
  empty.hidden = matches.length > 0;
  empty.textContent = query ? "No matches found." : "Completed games will appear here.";
  matches.forEach((match) => {
    const row = document.createElement("tr");
    const winnerTeam = match.winner === "team-a" ? 0 : 1;
    const winnerNames = match.playerNames.slice(winnerTeam * match.teamSize, (winnerTeam + 1) * match.teamSize);
    const loserNames = match.playerNames.slice((1 - winnerTeam) * match.teamSize, (2 - winnerTeam) * match.teamSize);
    const values = [
      { className: "match-number", text: String(match.number) },
      { className: "match-winner", text: winnerNames.join(" & ") },
      { className: "match-loser", text: loserNames.join(" & ") },
      { className: "match-score", text: `${match.gameTo}–${match.losingScore}` }
    ];
    values.forEach(({ className, text }) => {
      const cell = document.createElement("td");
      cell.className = className;
      cell.textContent = text;
      row.append(cell);
    });

    const actions = document.createElement("td");
    actions.className = "match-actions";
    const swap = document.createElement("button");
    swap.className = "match-action";
    swap.type = "button";
    swap.title = "Swap winner";
    swap.setAttribute("aria-label", `Swap winner for Match ${match.number}`);
    swap.append(makeMatchActionIcon("M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"));
    swap.addEventListener("click", () => swapMatchWinner(match.id));
    const remove = document.createElement("button");
    remove.className = "match-action match-delete";
    remove.type = "button";
    remove.title = "Delete Match";
    remove.setAttribute("aria-label", `Delete Match ${match.number}`);
    remove.append(makeMatchActionIcon("M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7"));
    remove.addEventListener("click", () => confirmAction(
      `Delete Match ${match.number}?`,
      "This will remove the match from the log and update player records.",
      () => deleteMatch(match.id),
      "Delete Match"
    ));
    actions.append(swap, remove);
    row.append(actions);
    list.append(row);
  });
  list.style.maxHeight = matches.length > 15
    ? `${[...list.rows].slice(0, 15).reduce((height, row) => height + row.offsetHeight, 0)}px`
    : "";
}

function makeTeam(players, className, courtId, courtNumber) {
  const team = document.createElement("div");
  team.className = `team ${className}`;
  players.forEach((player) => {
    const entry = document.createElement("button");
    entry.className = "team-player";
    entry.type = "button";
    entry.setAttribute("aria-label", `Change ${player.name} on Court ${courtNumber}`);
    entry.title = `Change ${player.name}`;
    entry.addEventListener("click", () => openReplaceDialog(courtId, player.id));
    const avatar = document.createElement("span");
    avatar.className = "mini-avatar";
    avatar.textContent = playerInitials(player.name);
    const name = document.createElement("span");
    name.className = "team-player-name";
    name.textContent = player.name;
    const change = document.createElement("span");
    change.className = "team-player-change";
    change.setAttribute("aria-hidden", "true");
    change.textContent = "↻";
    entry.append(avatar, name, change);
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

function recordWinner(courtId, winner) {
  const court = state.courts.find((item) => item.id === courtId);
  const playersPerCourt = state.format === "singles" ? 2 : 4;
  if (!court || (winner !== "team-a" && winner !== "team-b") || court.playerIds.length !== playersPerCourt) return;
  activeRecord = {
    courtId,
    winner,
    gameTo: 11,
    losingScore: null,
    legacyWinner: !state.matches.some((match) => match.id === court.matchId) ? court.winner : null
  };
  const previous = state.matches.find((match) => match.id === court.matchId);
  if (previous) {
    activeRecord.gameTo = previous.gameTo;
    activeRecord.losingScore = previous.losingScore;
  }
  renderRecordDialog();
  recordDialog.showModal();
}

function renderRecordDialog() {
  const court = state.courts.find((item) => item.id === activeRecord?.courtId);
  if (!court || !activeRecord) return;
  const teamSize = state.format === "singles" ? 1 : 2;
  const teams = [
    court.playerIds.slice(0, teamSize).map(playerById).filter(Boolean),
    court.playerIds.slice(teamSize).map(playerById).filter(Boolean)
  ];
  const container = document.querySelector("#record-teams");
  container.replaceChildren();
  teams.forEach((teamPlayers, index) => {
    const team = index === 0 ? "team-a" : "team-b";
    const winning = activeRecord.winner === team;
    const row = document.createElement("div");
    row.className = `record-team${winning ? " is-winning" : ""}`;
    const badge = document.createElement("span");
    badge.className = `record-badge${winning ? " is-win" : ""}`;
    badge.textContent = winning ? "WIN" : "LOSE";
    const names = document.createElement("span");
    names.className = "record-team-names";
    names.textContent = teamPlayers.map((player) => player.name).join(" & ");
    const score = document.createElement("strong");
    score.className = "record-team-score";
    score.textContent = winning ? String(activeRecord.gameTo) : activeRecord.losingScore === null ? "—" : String(activeRecord.losingScore);
    row.append(badge, names, score);
    container.append(row);
  });
  const targets = document.querySelector("#game-targets");
  targets.replaceChildren();
  [11, 15, 21].forEach((target) => {
    const button = document.createElement("button");
    button.className = `record-choice${activeRecord.gameTo === target ? " is-selected" : ""}`;
    button.type = "button";
    button.textContent = `${activeRecord.gameTo === target ? "✓ " : ""}${target}`;
    button.setAttribute("aria-pressed", String(activeRecord.gameTo === target));
    button.addEventListener("click", () => {
      activeRecord.gameTo = target;
      renderRecordDialog();
    });
    targets.append(button);
  });
  const losingScores = document.querySelector("#losing-scores");
  losingScores.replaceChildren();
  for (let score = 0; score <= 10; score += 1) {
    const button = document.createElement("button");
    button.className = `record-choice${activeRecord.losingScore === score ? " is-selected" : ""}`;
    button.type = "button";
    button.textContent = String(score);
    button.setAttribute("aria-pressed", String(activeRecord.losingScore === score));
    button.addEventListener("click", () => {
      activeRecord.losingScore = score;
      renderRecordDialog();
    });
    losingScores.append(button);
  }
  document.querySelector("#record-match-form button[type='submit']").disabled = activeRecord.losingScore === null;
}

function applyMatchRecord(match, amount) {
  match.playerIds.forEach((playerId, index) => {
    const player = playerById(playerId);
    if (!player) return;
    const playerWon = (index < match.teamSize) === (match.winner === "team-a");
    const result = playerWon ? "wins" : "losses";
    player[result] = Math.max(0, player[result] + amount);
  });
}

function saveMatchResult() {
  if (!activeRecord || activeRecord.losingScore === null) return;
  const court = state.courts.find((item) => item.id === activeRecord.courtId);
  if (!court) return;
  const existing = state.matches.find((match) => match.id === court.matchId);
  if (existing) {
    applyMatchRecord(existing, -1);
    existing.winner = activeRecord.winner;
    existing.gameTo = activeRecord.gameTo;
    existing.losingScore = activeRecord.losingScore;
    applyMatchRecord(existing, 1);
  } else {
    const teamSize = state.format === "singles" ? 1 : 2;
    const players = court.playerIds.map(playerById).filter(Boolean);
    if (players.length !== teamSize * 2) return;
    const match = {
      id: makeId(),
      number: state.nextMatchNumber,
      courtId: court.id,
      playerIds: players.map((player) => player.id),
      playerNames: players.map((player) => player.name),
      teamSize,
      winner: activeRecord.winner,
      gameTo: activeRecord.gameTo,
      losingScore: activeRecord.losingScore
    };
    state.matches.push(match);
    state.nextMatchNumber += 1;
    court.matchId = match.id;
    if (activeRecord.legacyWinner) {
      match.winner = activeRecord.legacyWinner;
      applyMatchRecord(match, -1);
      match.winner = activeRecord.winner;
    }
    applyMatchRecord(match, 1);
  }
  court.winner = activeRecord.winner;
  activeRecord = null;
  recordDialog.close();
  saveState();
  render();
}

function swapMatchWinner(matchId) {
  const match = state.matches.find((entry) => entry.id === matchId);
  if (!match) return;
  applyMatchRecord(match, -1);
  match.winner = match.winner === "team-a" ? "team-b" : "team-a";
  applyMatchRecord(match, 1);
  const court = state.courts.find((entry) => entry.matchId === match.id);
  if (court) court.winner = match.winner;
  saveState();
  render();
}

function deleteMatch(matchId) {
  const index = state.matches.findIndex((entry) => entry.id === matchId);
  if (index < 0) return;
  const [match] = state.matches.splice(index, 1);
  applyMatchRecord(match, -1);
  const court = state.courts.find((entry) => entry.matchId === match.id);
  if (court) {
    court.matchId = null;
    court.winner = null;
  }
  saveState();
  render();
}

function confirmAction(title, message, action, confirmLabel) {
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  document.querySelector("#accept-confirm").textContent = confirmLabel;
  pendingConfirmation = action;
  confirmDialog.showModal();
}

function renderResults() {
  const list = document.querySelector("#results-list");
  list.replaceChildren();
  if (state.players.length === 0) {
    const empty = document.createElement("li");
    empty.className = "results-empty";
    empty.textContent = "Add players to see the session standings.";
    list.append(empty);
    return;
  }
  rankPlayers(state.players).forEach((player, index) => {
    const item = document.createElement("li");
    item.className = `result-row${index < 3 ? ` result-place-${index + 1}` : ""}`;

    const rank = document.createElement("span");
    rank.className = "result-rank";
    const medals = ["🥇", "🥈", "🥉"];
    rank.textContent = index < medals.length ? medals[index] : String(index + 1);
    rank.classList.toggle("result-rank-medal", index < medals.length);
    rank.setAttribute("aria-label", `Place ${index + 1}`);

    const name = document.createElement("span");
    name.className = "result-name";
    name.textContent = player.name;

    const stats = document.createElement("span");
    stats.className = "result-stats";
    const record = document.createElement("span");
    record.className = "result-record";
    record.textContent = `${player.wins} W · ${player.losses} L`;
    const gamesPlayed = player.wins + player.losses;
    const winRate = gamesPlayed ? Math.round((player.wins / gamesPlayed) * 100) : 0;
    const metrics = document.createElement("span");
    metrics.className = "result-metrics";
    metrics.textContent = `${gamesPlayed} ${gamesPlayed === 1 ? "game" : "games"} · ${winRate}% win rate`;
    stats.append(record, metrics);

    item.append(rank, name, stats);
    list.append(item);
  });
}

function clearRecords() {
  state.players.forEach((player) => {
    player.wins = 0;
    player.losses = 0;
  });
}

function resetAll() {
  clearRecords();
  state.matches = [];
  state.nextMatchNumber = 1;
  state.courts.forEach((court) => {
    court.playerIds = [];
    court.round = 0;
    court.winner = null;
    court.matchId = null;
  });
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

function selectFairPlayers(eligiblePlayers, amount, previousPlayers = new Set()) {
  return shuffle(eligiblePlayers)
    .sort((a, b) => (a.wins + a.losses) - (b.wins + b.losses)
      || Number(previousPlayers.has(a.id)) - Number(previousPlayers.has(b.id)))
    .slice(0, amount);
}

function randomizeCourt(courtId) {
  const court = state.courts.find((item) => item.id === courtId);
  if (!court) return;
  const completed = Boolean(court.winner || state.matches.some((match) => match.id === court.matchId));
  const busy = new Set(state.courts.filter((item) => item.id !== courtId).flatMap((item) => item.playerIds));
  const amount = state.format === "singles" ? 2 : 4;
  const previousPlayers = new Set(court.playerIds);
  const available = state.players.filter((player) => !busy.has(player.id));
  if (available.length < amount) {
    showNotice(`Court ${state.courts.indexOf(court) + 1} needs ${amount} available players; ${available.length} ${available.length === 1 ? "is" : "are"} free.`);
    return;
  }
  const selectedPlayers = selectFairPlayers(available, amount, previousPlayers);
  court.playerIds = shuffle(selectedPlayers).map((player) => player.id);
  court.winner = null;
  court.matchId = null;
  if (court.round === 0 || completed) court.round += 1;
  showNotice("");
  saveState();
  render();
}

function availableReplacementPlayers() {
  const assigned = new Set(state.courts.flatMap((court) => court.playerIds));
  return state.players.filter((player) => !assigned.has(player.id));
}

function openReplaceDialog(courtId, playerId) {
  const court = state.courts.find((item) => item.id === courtId);
  const player = playerById(playerId);
  if (!court?.playerIds.includes(playerId) || !player) return;

  activeReplacement = { courtId, playerId };
  const courtNumber = state.courts.indexOf(court) + 1;
  document.querySelector("#replace-description").textContent = `Replace ${player.name} on Court ${courtNumber}. The other players will stay in place.`;

  const select = document.querySelector("#replacement-player");
  select.replaceChildren();
  const available = availableReplacementPlayers().sort((a, b) => a.name.localeCompare(b.name));
  available.forEach((candidate) => {
    const option = document.createElement("option");
    option.value = candidate.id;
    option.textContent = candidate.name;
    select.append(option);
  });
  const empty = available.length === 0;
  select.disabled = empty;
  document.querySelector("#replace-empty").hidden = !empty;
  document.querySelector("#random-replacement").disabled = empty;
  document.querySelector("#save-replacement").disabled = empty;
  replaceDialog.showModal();
  if (!empty) select.focus();
}

function replaceCourtPlayer(courtId, playerId, replacementId) {
  const court = state.courts.find((item) => item.id === courtId);
  const slot = court?.playerIds.indexOf(playerId) ?? -1;
  if (slot < 0 || !availableReplacementPlayers().some((player) => player.id === replacementId)) return false;

  const completed = Boolean(court.winner || state.matches.some((match) => match.id === court.matchId));
  court.playerIds[slot] = replacementId;
  court.winner = null;
  court.matchId = null;
  if (completed) court.round += 1;
  showNotice("");
  saveState();
  render();
  return true;
}

function resetCourt(courtId) {
  const court = state.courts.find((item) => item.id === courtId);
  if (!court) return;
  court.playerIds = [];
  court.winner = null;
  court.matchId = null;
  showNotice("");
  saveState();
  render();
}

function randomizeAll() {
  const amount = state.format === "singles" ? 2 : 4;
  let pool = [...state.players];
  let filled = 0;
  state.courts.forEach((court) => {
    const completed = Boolean(court.winner || state.matches.some((match) => match.id === court.matchId));
    court.winner = null;
    court.matchId = null;
    if (pool.length >= amount) {
      const selectedPlayers = selectFairPlayers(pool, amount);
      const selectedIds = new Set(selectedPlayers.map((player) => player.id));
      pool = pool.filter((player) => !selectedIds.has(player.id));
      court.playerIds = shuffle(selectedPlayers).map((player) => player.id);
      if (court.round === 0 || completed) court.round += 1;
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
  saveState();
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
      court.matchId = null;
    }
  });
  saveState();
  render();
}

function render() {
  renderPlayers();
  renderCourts();
  renderMatchLog();
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
document.querySelector("#replace-player-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!activeReplacement) return;
  const replacementId = document.querySelector("#replacement-player").value;
  if (replaceCourtPlayer(activeReplacement.courtId, activeReplacement.playerId, replacementId)) replaceDialog.close();
});
document.querySelector("#random-replacement").addEventListener("click", () => {
  if (!activeReplacement) return;
  const available = availableReplacementPlayers();
  if (available.length === 0) return;
  const player = available[Math.floor(Math.random() * available.length)];
  if (replaceCourtPlayer(activeReplacement.courtId, activeReplacement.playerId, player.id)) replaceDialog.close();
});
document.querySelector("#close-replace").addEventListener("click", () => replaceDialog.close());
replaceDialog.addEventListener("close", () => { activeReplacement = null; });
document.querySelector("#show-results").addEventListener("click", () => {
  renderResults();
  resultsDialog.showModal();
});
document.querySelector("#close-results").addEventListener("click", () => resultsDialog.close());
document.querySelector("#reset-records").addEventListener("click", () => {
  confirmAction(
    "Reset all records?",
    "This will clear match history, player records, and current court assignments.",
    resetAll,
    "Reset All"
  );
});
document.querySelector("#clear-players").addEventListener("click", () => {
  confirmAction(
    "Clear all players?",
    "This will remove every player and clear current court assignments. Match log history will remain.",
    () => {
      state.players = [];
      state.courts.forEach((court) => {
        court.playerIds = [];
        court.winner = null;
        court.matchId = null;
      });
      saveState();
      render();
    },
    "Clear all"
  );
});
document.querySelectorAll(".format-option").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.format === state.format) return;
    state.format = button.dataset.format;
    state.courts.forEach((court) => {
      court.playerIds = [];
      court.winner = null;
      court.matchId = null;
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
document.querySelector("#match-search").addEventListener("input", renderMatchLog);
document.querySelector("#accept-confirm").addEventListener("click", () => {
  const action = pendingConfirmation;
  pendingConfirmation = null;
  confirmDialog.close();
  action?.();
});
document.querySelector("#cancel-confirm").addEventListener("click", () => confirmDialog.close());
confirmDialog.addEventListener("close", () => { pendingConfirmation = null; });
document.querySelector("#record-match-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveMatchResult();
});
document.querySelector("#record-swap").addEventListener("click", () => {
  if (!activeRecord) return;
  activeRecord.winner = activeRecord.winner === "team-a" ? "team-b" : "team-a";
  renderRecordDialog();
});
document.querySelector("#close-record").addEventListener("click", () => recordDialog.close());
document.querySelector("#cancel-record").addEventListener("click", () => recordDialog.close());
recordDialog.addEventListener("close", () => { activeRecord = null; });

document.querySelector("#session-date").textContent = new Intl.DateTimeFormat(undefined, {
  weekday: "short", month: "short", day: "numeric", year: "numeric"
}).format(new Date());

render();
