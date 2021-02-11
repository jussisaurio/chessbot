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

let puzzleState = {};

const playerColor = (game) => (game.turn() === "w" ? "White" : "Black");

const formatUrl = (state) =>
  `This puzzle is rated ELO ${state.data.elo}. ${playerColor(
    state.game
  )} to move. ${SERVER_URL}/puzzle/${encodeURIComponent(state.game.fen())}`;

slackEvents.on("app_mention", async (event) => {
  console.log("Received an event");
  console.log(JSON.stringify(event, null, 2));

  const textField = event.blocks.elements.find((e) => e.type === "text");

  if (!textField) return;

  const text = textField.text.trim().toLowerCase();
  const channel = event.channel;

  // user requesting new puzzle
  if (text === "new") {
    return await newPuzzleHandler(channel);
  } else if (text === "resign") {
    return await resignHandler(channel);
  }
});

app.get("/puzzle/:fen", async (req, res, next) => {
  try {
    await imageGenerator.loadFEN(decodeURIComponent(req.params.fen));
    const buf = await imageGenerator.generateBuffer();

    res.setHeader("Content-Type", "image/png");
    res.status(200).send(buf);
  } catch (e) {
    puzzleState = initialState();
    res.status(500).json({ error: "Something went wrong" });
  }
});

async function newPuzzleHandler(channel) {
  if (!puzzle[channel]) puzzle[channel] = initialState();

  if (puzzle[channel].active) {
    return await webhook.send({
      text: `There is already an active puzzle on this channel. Mention me with the text 'resign' to give up. In the meantime, here is the current puzzle: ${formatUrl(
        puzzle[channel]
      )}`
    });
  }

  const { game, data } = await getNewPuzzle();

  puzzle[channel].active = true;
  puzzle[channel].data = data;
  puzzle[channel].game = game;

  return await webhook.send({
    text: formatUrl(puzzle[channel])
  });
}

async function resignHandler(channel) {
  if (puzzle[channel].active) {
    puzzle[channel] = initialState();
    return await webhook.send({
      text: `Too hard for you? Mention me with the text 'new' to start a new puzzle`
    });
  } else {
    return await webhook.send({
      text: `There is no active puzzle currently. Mention me with the text 'new' to start a new puzzle`
    });
  }
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
