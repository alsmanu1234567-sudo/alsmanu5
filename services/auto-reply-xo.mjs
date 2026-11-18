import { randomUUID } from "node:crypto";
import { quickReply, sendInteractive } from "./interactive.js";

const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
const GAME_TTL_MS = 30 * 60 * 1_000;
const MAX_GAMES = 500;

function gameResult(board) {
  for (const [a, b, c] of WINNING_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.every(Boolean) ? "draw" : null;
}

function chooseBotMove(board) {
  const winningMove = (mark) => {
    for (let index = 0; index < board.length; index += 1) {
      if (board[index]) continue;
      board[index] = mark;
      const wins = gameResult(board) === mark;
      board[index] = null;
      if (wins) return index;
    }
    return -1;
  };
  const win = winningMove("O");
  if (win >= 0) return win;
  const block = winningMove("X");
  if (block >= 0) return block;
  for (const index of [4, 0, 2, 6, 8, 1, 3, 5, 7]) {
    if (!board[index]) return index;
  }
  return -1;
}

function gameKey(ownerId, gameId) {
  return `${ownerId}\u0000${gameId}`;
}

export function createAutoReplyXoGame({
  sendInteractiveFn = sendInteractive,
  quickReplyFn = quickReply,
  now = Date.now,
  idFactory = randomUUID,
} = {}) {
  const games = new Map();

  function pruneGames() {
    const time = now();
    for (const [key, game] of games) {
      if (game.expiresAt <= time) games.delete(key);
    }
    while (games.size > MAX_GAMES) games.delete(games.keys().next().value);
  }

  function createGame(chatId, playerId, playerName, ownerId) {
    const id = String(idFactory()).replaceAll("-", "").slice(0, 20);
    const game = {
      id,
      chatId: String(chatId),
      playerId: String(playerId),
      playerName: String(playerName || "لاعب").slice(0, 60),
      ownerId: String(ownerId || ""),
      board: Array(9).fill(null),
      status: "active",
      expiresAt: now() + GAME_TTL_MS,
    };
    games.set(gameKey(game.ownerId, id), game);
    pruneGames();
    return game;
  }

  async function render(sock, game, notice = "") {
    const cells = game.board.map((mark, index) => mark || String(index + 1));
    const boardText = [
      ` ${cells[0]} │ ${cells[1]} │ ${cells[2]} `,
      "───┼───┼───",
      ` ${cells[3]} │ ${cells[4]} │ ${cells[5]} `,
      "───┼───┼───",
      ` ${cells[6]} │ ${cells[7]} │ ${cells[8]} `,
    ].join("\n");
    let status = notice;
    if (!status && game.status === "active") status = `دورك يا ${game.playerName}: اضغط رقم الخانة.`;
    if (!status && game.status === "X") status = "مبروك، فزت!";
    if (!status && game.status === "O") status = "فاز البوت هذه المرة.";
    if (!status && game.status === "draw") status = "تعادل!";

    const buttons = game.status === "active"
      ? [
          ...game.board.flatMap((mark, index) => mark
            ? []
            : [quickReplyFn(String(index + 1), `arxo:${game.id}:move:${index}`)]),
          quickReplyFn("إلغاء اللعبة", `arxo:${game.id}:cancel`),
        ]
      : [quickReplyFn("لعبة جديدة", `arxo:${game.id}:replay`)];

    await sendInteractiveFn(sock, game.chatId, {
      headerTitle: "🎮 لعبة X و O",
      text: `${status}\n\n${boardText}`,
      footer: "أنت X  •  البوت O",
      buttons,
    });
  }

  async function start(sock, chatId, playerId, playerName = "", ownerId = "") {
    if (!chatId || !playerId) throw new Error("لا يمكن بدء اللعبة دون محادثة ولاعب");
    const game = createGame(chatId, playerId, playerName, ownerId);
    try {
      await render(sock, game);
    } catch (error) {
      games.delete(gameKey(game.ownerId, game.id));
      throw error;
    }
    return { gameId: game.id };
  }

  async function handle(sock, chatId, playerId, responseId, ownerId = "") {
    const id = String(responseId || "");
    if (!id.startsWith("arxo:")) return false;
    pruneGames();
    const [, gameId, action, value] = id.split(":");
    const key = gameKey(String(ownerId || ""), gameId || "");
    const game = games.get(key);
    if (!game) return true;
    if (game.chatId !== String(chatId) || game.playerId !== String(playerId)) return true;

    if (action === "cancel") {
      games.delete(key);
      await sock.sendMessage(game.chatId, { text: "تم إلغاء لعبة X و O." });
      return true;
    }
    if (action === "replay" && game.status !== "active") {
      games.delete(key);
      await start(sock, game.chatId, game.playerId, game.playerName, game.ownerId);
      return true;
    }
    if (action !== "move" || game.status !== "active") return true;

    const position = Number(value);
    if (!Number.isInteger(position) || position < 0 || position > 8 || game.board[position]) {
      await render(sock, game, "هذه الخانة غير متاحة. اختر خانة فارغة.");
      return true;
    }

    game.board[position] = "X";
    let result = gameResult(game.board);
    if (!result) {
      const botPosition = chooseBotMove(game.board);
      if (botPosition >= 0) game.board[botPosition] = "O";
      result = gameResult(game.board);
    }
    game.status = result || "active";
    game.expiresAt = now() + GAME_TTL_MS;
    await render(sock, game);
    return true;
  }

  return { start, handle };
}

const defaultGame = createAutoReplyXoGame();

export function startAutoReplyXoGame(sock, chatId, playerId, playerName, ownerId) {
  return defaultGame.start(sock, chatId, playerId, playerName, ownerId);
}

export function handleAutoReplyXoInteraction(sock, chatId, playerId, responseId, ownerId) {
  return defaultGame.handle(sock, chatId, playerId, responseId, ownerId);
}
