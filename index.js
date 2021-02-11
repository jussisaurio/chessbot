const axios = require("axios");
const express = require("express");
const ChessImageGenerator = require("chess-image-generator");
const { Chess } = require("chess.js");
const bodyParser = require("body-parser");
const imageGenerator = new ChessImageGenerator({
  size: 720,
  style: "merida"
});

const SERVER_URL = process.env.SERVER_URL || "http://localhost:1337";
const SLACK_WEBHOOK_URL = process.env_SLACK_WEBHOOK_URL;

const app = express();

app.use(bodyParser.json());

const initialState = () => ({
  active: false,
  data: null,
  game: null,
  playerColor: null
});

let puzzleState = initialState();

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

app.post("/puzzle", async (req, res, next) => {
  if (!req.body) {
    return;
  }
  if (req.body.challenge) {
    return res.status(200).send(req.body.challenge);
  }

  if (puzzleState.active) {
    return res
      .status(400)
      .json({ error: "There is already a puzzle in progress" });
  }

  puzzleState.active = true;
  try {
    const { game, data } = await getNewPuzzle();
    puzzleState.data = data;
    puzzleState.playerColor = game.turn() === "w" ? "White" : "Black";
    puzzleState.game = game;

    const message = {
      text: `This puzzle is rated ELO ${puzzleState.data.elo}. ${
        puzzleState.playerColor
      } to move. ${SERVER_URL}/puzzle/${encodeURIComponent(game.fen())}`
    };
    console.log({ message });
    await postSlackMessage(message);
    res.status(200).send();
  } catch (e) {
    puzzleState = initialState();
    res.status(500).json({ error: "Something went wrong" });
  }
});

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

const PORT = process.env.PORT || 1337;

app.listen(PORT, () => {
  console.log("Chessbot active on port " + PORT);
});

function postSlackMessage(message) {
  return SLACK_WEBHOOK_URL
    ? axios.post(SLACK_WEBHOOK_URL, message)
    : Promise.resolve();
}
