const axios = require("axios");
const express = require("express");
const ChessImageGenerator = require("chess-image-generator");
const { Chess } = require("chess.js");
const { createEventAdapter } = require("@slack/events-api");
const { IncomingWebhook } = require("@slack/webhook");

const webhook = new IncomingWebhook(process.env.SLACK_WEBHOOK_URL);
const slackEvents = createEventAdapter(process.env.SLACK_SIGNING_SECRET);
const PORT = process.env.PORT || 1337;

const imageGenerator = new ChessImageGenerator({
  size: 720,
  style: "merida"
});

const SERVER_URL = process.env.SERVER_URL || "http://localhost:1337";

const app = express();

app.use("/slack/events", slackEvents.expressMiddleware());

const initialState = () => ({
  active: false,
  data: null,
  game: null
});

const puzzleState = {};

const playerColor = (game) => (game.turn() === "w" ? "White" : "Black");

const formatPuzzleDescription = (state) =>
  `This puzzle is rated ELO ${state.data.elo}. ${playerColor(
    state.game
  )} to move. Mention me with a legal chess move (e.g. ${
    state.game.moves()[0]
  }) to continue. \nList of legal moves: ${state.game
    .moves()
    .join(", ")} .\n ${SERVER_URL}/puzzle/${encodeURIComponent(
    state.game.fen()
  )}`;

const formatPuzzleContinuation = (state, opponentMove) =>
  `Opponent moves ${opponentMove}. ${playerColor(
    state.game
  )} to move. \nList of legal moves: ${state.game
    .moves()
    .join(", ")} .\n ${SERVER_URL}/puzzle/${encodeURIComponent(
    state.game.fen()
  )}`;

slackEvents.on("app_mention", async (event) => {
  console.log("Received an event");
  console.log(JSON.stringify(event, null, 2));

  const textField = event.blocks
    .find((b) => b.type === "rich_text")
    ?.elements.find((e) => e.type === "rich_text_section")
    ?.elements.find((e) => e.type === "text");

  if (!textField) return;

  const text = textField.text.trim();
  const channel = event.channel;

  if (text.toLowerCase() === "new") {
    return await newPuzzleHandler(channel);
  } else if (text.toLowerCase() === "resign") {
    return await resignHandler(channel);
  } else {
    return await moveHandler(channel, text);
  }
});

app.get("/puzzle/:fen", async (req, res, next) => {
  try {
    await imageGenerator.loadFEN(decodeURIComponent(req.params.fen));
    const buf = await imageGenerator.generateBuffer();

    res.setHeader("Content-Type", "image/png");
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: "Something went wrong" });
  }
});

async function newPuzzleHandler(channel) {
  if (!puzzleState[channel]) puzzleState[channel] = initialState();

  if (puzzleState[channel].active) {
    return await webhook.send({
      text: `There is already an active puzzle on this channel. Mention me with the text 'resign' to give up. In the meantime, here is the current puzzle: ${formatPuzzleDescription(
        puzzleState[channel]
      )}`
    });
  }

  const { game, data } = await getNewPuzzle();

  puzzleState[channel].active = true;
  puzzleState[channel].data = data;
  puzzleState[channel].game = game;

  return await webhook.send({
    text: formatPuzzleDescription(puzzleState[channel])
  });
}

async function resignHandler(channel) {
  if (puzzleState[channel]?.active) {
    puzzleState[channel] = initialState();
    return await webhook.send({
      text: `Too hard for you? Mention me with the text 'new' to start a new puzzle`
    });
  } else {
    return await webhook.send({
      text: `There is no active puzzle currently. Mention me with the text 'new' to start a new puzzle`
    });
  }
}

async function moveHandler(channel, move) {
  if (!puzzleState[channel]) {
    return await webhook.send({
      text: `There is no active puzzle currently. Mention me with the text 'new' to start a new puzzle`
    });
  }

  const { game, data } = puzzleState[channel];

  if (!game.move(move)) {
    return await webhook.send({
      text: `${move} is not a legal move, unless I am mistaken. Try of one of: ${game.moves()}`
    });
  }

  if (move !== data.forcedLine[0]) {
    puzzleState[channel] = initialState();
    return await webhook.send({
      text: `${move} is not correct. Try again by mentioning me with the text 'new'.`
    });
  }

  data.forcedLine.shift();

  if (!data.forcedLine.length) {
    puzzleState[channel] = initialState();
    return await webhook.send({
      text: `${move} is correct. Congratulations, you have solved the puzzle!`
    });
  }

  const opponentMove = data.forcedLine.shift();

  if (!game.move(opponentMove)) {
    return await webhook.send({
      text: `Application error, contact jsaurio and tell him to pls fix`
    });
  }

  return await webhook.send({
    text: formatPuzzleContinuation(puzzleState[channel], opponentMove)
  });
}

const getNewPuzzle = async () => {
  try {
    const res = await axios.post("https://chessblunders.org/api/blunder/get", {
      type: "explore"
    });

    const data = res.data.data;

    console.log(data);

    const game = new Chess(data.fenBefore);

    game.move(data.blunderMove);

    return {
      data,
      game
    };
  } catch (e) {
    console.error(e);
  }
};

app.listen(PORT, () => {
  console.log("Chessbot active on port " + PORT);
});
