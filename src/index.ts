import { createServer } from "http";
import { Server } from "colyseus";
import { GameRoom } from "./rooms/GameRoom";

// Standard Node HTTP server
const server = createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { 
      "Content-Type": "text/plain",
      "Access-Control-Allow-Origin": "*" 
    });
    res.end("Tabletop Server is running!");
  }
});

// Attach Colyseus natively without @colyseus/tools
const gameServer = new Server({
  server: server,
});

// Register the room
gameServer.define("tabletop_room", GameRoom);

const PORT = Number(process.env.PORT || 2567);
const HOST = "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`Tabletop Server listening on port ${PORT}`);
});