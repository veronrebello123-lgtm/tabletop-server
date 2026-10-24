import { Room, Client } from "colyseus";
import { ArraySchema } from "@colyseus/schema";
import { TableState, PlayerSchema, TokenSchema, ZoneSchema } from "../schema/TableState";

const COLOR_OPTIONS = [
  0xF0A30A, 0x825A2C, 0x0050EF, 0xA20025, 0x1BA1E2, 0xD80073,
  0xA4C400, 0x6A00FF, 0x60A917, 0x008A00, 0x76608A, 0x6D8764,
  0xFA6800, 0xF472D0, 0xE51400, 0x7A3B3F, 0x647687, 0x00ABA9,
  0xAA00FF, 0xD8C100
];

export class GameRoom extends Room<TableState> {
  maxClients = 8;
  private explicitQuits = new Set<string>();

  private getTokenHalfSize(token: TokenSchema): number {
    if (token.type === "board") return 0;
    return (token.type === "card" ? 70 : 40) * (token.scale || 1);
  }

  private isRestrictedInOpponentMat(token: TokenSchema, clientSessionId: string): boolean {
    if (token.type === "board" || token.layerTier === -1) return false;
    let restricted = false;
    this.state.zones.forEach((zone) => {
      if (
        zone.ownerId !== clientSessionId &&
        token.x >= zone.x &&
        token.x <= zone.x + zone.width &&
        token.y >= zone.y &&
        token.y <= zone.y + zone.height
      ) {
        restricted = true;
      }
    });
    return restricted;
  }

  private ensureActiveHost() {
    const players = Array.from(this.state.players.values()) as PlayerSchema[];
    const hasAnyHost = players.some((p: PlayerSchema) => p.isPlaying && p.isHost);
    if (!hasAnyHost) {
      const nextHost: PlayerSchema | undefined =
        players.find((p: PlayerSchema) => p.isPlaying && p.isConnected) ||
        players.find((p: PlayerSchema) => p.isPlaying);
      if (nextHost) {
        nextHost.isHost = true;
      }
    }
  }

  onCreate(options: any) {
    this.setState(new TableState());

    this.onMessage("reserveColor", (client, message: { color: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const players = Array.from(this.state.players.values()) as PlayerSchema[];
      const isTaken = players.some(
        (p: PlayerSchema) => p.color === message.color && p.id !== client.sessionId
      );
      if (!isTaken) {
        player.color = message.color;
        const zone = this.state.zones.get(`zone_${client.sessionId}`);
        if (zone) {
          zone.color = message.color;
        }
      }
    });

    this.onMessage("joinGame", (client, message: { name: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      player.name = (message.name || "Player").trim();
      player.isPlaying = true;

      const zone = this.state.zones.get(`zone_${client.sessionId}`);
      if (zone) {
        zone.label = `${player.name}'s Mat`;
      }

      this.ensureActiveHost();
    });

    this.onMessage("transferHost", (client, message: { targetId: string }) => {
      const sender = this.state.players.get(client.sessionId);
      const target = this.state.players.get(message.targetId);
      if (!sender?.isHost || !target || !target.isPlaying || !target.isConnected) return;

      sender.isHost = false;
      target.isHost = true;
    });

    this.onMessage("quitGame", (client, message: { targetHostId?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      this.explicitQuits.add(client.sessionId);

      this.state.tokens.forEach((token) => {
        if (token.selectedById === client.sessionId) token.selectedById = "";
      });

      const zoneId = `zone_${client.sessionId}`;
      if (this.state.zones.has(zoneId)) {
        this.state.zones.delete(zoneId);
      }

      const wasHost = player.isHost;
      this.state.players.delete(client.sessionId);

      if (wasHost) {
        if (message?.targetHostId) {
          const target = this.state.players.get(message.targetHostId);
          if (target && target.isPlaying && target.isConnected) {
            target.isHost = true;
          }
        }
        this.ensureActiveHost();
      }
    });

    this.onMessage("selectTokens", (client, message: { ids: string[]; exclusive?: boolean }) => {
      const { ids, exclusive } = message;
      if (!Array.isArray(ids)) return;

      if (exclusive) {
        this.state.tokens.forEach((token) => {
          if (token.selectedById === client.sessionId && !ids.includes(token.id)) {
            token.selectedById = "";
          }
        });
      }

      const sortedIds = [...ids].sort((a, b) => {
        const tokenA = this.state.tokens.get(a);
        const tokenB = this.state.tokens.get(b);
        return (tokenA?.zIndex || 0) - (tokenB?.zIndex || 0);
      });

      sortedIds.forEach((id) => {
        const token = this.state.tokens.get(id);
        if (!token) return;
        if (token.selectedById !== "" && token.selectedById !== client.sessionId) return;
        if (this.isRestrictedInOpponentMat(token, client.sessionId)) return;

        token.selectedById = client.sessionId;
        if (token.type !== "board") {
          this.state.highestZIndex += 1;
          token.zIndex = this.state.highestZIndex;
        }
      });
    });

    this.onMessage("clearSelection", (client) => {
      this.state.tokens.forEach((token) => {
        if (token.selectedById === client.sessionId) token.selectedById = "";
      });
    });

    this.onMessage("moveTokens", (client, message: { ids: string[]; dx: number; dy: number }) => {
      const { ids, dx, dy } = message;
      if (!Array.isArray(ids)) return;

      ids.forEach((id) => {
        const token = this.state.tokens.get(id);
        if (token && !token.isLocked && (token.selectedById === "" || token.selectedById === client.sessionId)) {
          const pad = this.getTokenHalfSize(token);
          token.x = Math.max(pad, Math.min(5000 - pad, token.x + dx));
          token.y = Math.max(pad, Math.min(5000 - pad, token.y + dy));
        }
      });
    });

    this.onMessage("syncTokenState", (client, message: { id: string; x: number; y: number; rotation: number; diceValue?: number }) => {
      const token = this.state.tokens.get(message.id);
      if (token && !token.isLocked) {
        const pad = this.getTokenHalfSize(token);
        token.x = Math.max(pad, Math.min(5000 - pad, message.x));
        token.y = Math.max(pad, Math.min(5000 - pad, message.y));
        token.rotation = message.rotation;
        if (message.diceValue !== undefined) token.diceValue = message.diceValue;

        if (this.isRestrictedInOpponentMat(token, client.sessionId) && token.selectedById === client.sessionId) {
          token.selectedById = "";
        }
      }
    });

    this.onMessage("throwTokens", (client, message: { id: string; x: number; y: number; vx: number; vy: number; spin: number; finalDiceValue: number }) => {
      const token = this.state.tokens.get(message.id);
      if (token && !token.isLocked) {
        const pad = this.getTokenHalfSize(token);
        token.x = Math.max(pad, Math.min(5000 - pad, message.x));
        token.y = Math.max(pad, Math.min(5000 - pad, message.y));
        token.diceValue = message.finalDiceValue;
      }
      this.broadcast("onThrow", { ...message, senderId: client.sessionId });
    });

    this.onMessage("toggleLock", (client, message: { ids: string[] }) => {
      if (!Array.isArray(message.ids)) return;
      message.ids.forEach((id) => {
        const token = this.state.tokens.get(id);
        if (token && (token.selectedById === client.sessionId || token.selectedById === "")) {
          if (!this.isRestrictedInOpponentMat(token, client.sessionId)) token.isLocked = !token.isLocked;
        }
      });
    });

    this.onMessage("toggleZoneLock", (client, message: { id: string }) => {
      const zone = this.state.zones.get(message.id);
      if (!zone) return;
      const player = this.state.players.get(client.sessionId);
      const owner = this.state.players.get(zone.ownerId);
      
      if (client.sessionId === zone.ownerId || (player?.isHost && (!owner || !owner.isConnected))) {
        zone.isLocked = !zone.isLocked;
      }
    });

    this.onMessage("toggleZoneVisibility", (client, message: { id: string }) => {
      const zone = this.state.zones.get(message.id);
      if (zone && zone.ownerId === client.sessionId) {
        zone.isHidden = !zone.isHidden;
      }
    });

    this.onMessage("bringToFront", (client, message: { ids: string[] }) => {
      if (!Array.isArray(message.ids)) return;
      message.ids.forEach((id) => {
        const token = this.state.tokens.get(id);
        if (token && token.type !== "board") {
          this.state.highestZIndex += 1;
          token.zIndex = this.state.highestZIndex;
        }
      });
    });

    this.onMessage("rotateTokens", (client, message: { ids: string[]; degrees: number; absolute?: boolean }) => {
      if (!Array.isArray(message.ids)) return;
      message.ids.forEach((id) => {
        const token = this.state.tokens.get(id);
        if (token && !token.isLocked && token.selectedById === client.sessionId) {
          token.rotation = message.absolute ? message.degrees : (token.rotation || 0) + message.degrees;
        }
      });
    });

    this.onMessage("flipCard", (client, message: { ids: string[] }) => {
      if (!Array.isArray(message.ids)) return;
      message.ids.forEach((id) => {
        const token = this.state.tokens.get(id);
        if (token && token.type === "card" && !token.isLocked && token.selectedById === client.sessionId) {
          token.isFaceDown = !token.isFaceDown;
        }
      });
    });

    this.onMessage("cycleDice", (client, message: { ids: string[] }) => {
      if (!Array.isArray(message.ids)) return;
      message.ids.forEach((id) => {
        const token = this.state.tokens.get(id);
        if (token && token.type === "dice" && !token.isLocked) {
          token.diceValue = Math.floor(Math.random() * (token.diceSides || 6)) + 1;
        }
      });
    });

    this.onMessage("absorbIntoPouch", (client, message: { pouchId: string; tokenIds: string[] }) => {
      const pouch = this.state.tokens.get(message.pouchId);
      if (!pouch || pouch.type !== "pouch" || !pouch.isLocked || !Array.isArray(message.tokenIds)) return;

      message.tokenIds.forEach((id) => {
        if (id === pouch.id) return;
        const t = this.state.tokens.get(id);
        if (t && !t.isLocked && t.type !== "board" && t.type !== "pouch") {
          const clone = new TokenSchema();
          clone.id = t.id; clone.type = t.type; clone.name = t.name; clone.scale = t.scale;
          clone.imageUrl = t.imageUrl; clone.backUrl = t.backUrl; clone.isFaceDown = t.isFaceDown;
          clone.deckMode = t.deckMode; clone.sheetUrl = t.sheetUrl; clone.cols = t.cols;
          clone.rows = t.rows; clone.cardIndex = t.cardIndex; clone.diceValue = t.diceValue;
          clone.diceSides = t.diceSides; clone.label = t.label; clone.layerTier = t.layerTier;
          pouch.contents.push(clone);
          this.state.tokens.delete(id);
        }
      });
    });

    this.onMessage("drawFromPouch", (client, message: { pouchId: string; x: number; y: number }) => {
      const pouch = this.state.tokens.get(message.pouchId);
      if (!pouch || pouch.type !== "pouch" || pouch.contents.length === 0) return;

      this.state.tokens.forEach((t) => {
        if (t.selectedById === client.sessionId) t.selectedById = "";
      });

      const randIdx = Math.floor(Math.random() * pouch.contents.length);
      const data = pouch.contents.at(randIdx);
      pouch.contents.splice(randIdx, 1);

      if (!data) return;
      
      const id = `${data.type || "token"}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      this.state.highestZIndex += 1;

      const token = new TokenSchema();
      token.id = id; token.type = data.type || "token"; token.name = data.name || "Token";
      token.scale = data.scale || 1;
      const pad = this.getTokenHalfSize(token);
      token.x = Math.max(pad, Math.min(5000 - pad, message.x));
      token.y = Math.max(pad, Math.min(5000 - pad, message.y));
      token.rotation = 0;
      token.zIndex = this.state.highestZIndex; token.isLocked = false; token.imageUrl = data.imageUrl || "";
      token.backUrl = data.backUrl || ""; token.isFaceDown = data.isFaceDown || false;
      token.deckMode = data.deckMode || ""; token.sheetUrl = data.sheetUrl || ""; token.cols = data.cols || 0;
      token.rows = data.rows || 0; token.cardIndex = data.cardIndex || 0; token.diceValue = data.diceValue || 1;
      token.diceSides = data.diceSides || 6; token.selectedById = client.sessionId;
      token.label = data.label || ""; token.layerTier = data.layerTier || 0;
      this.state.tokens.set(id, token);
    });

    this.onMessage("spawnToken", (client, tokenData: any) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.isHost) return;

      const id = `${tokenData.type || "token"}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      this.state.highestZIndex += 1;
      const token = new TokenSchema();
      token.id = id; token.type = tokenData.type || "token"; token.name = tokenData.name || tokenData.type;
      token.scale = tokenData.scale || (tokenData.type === "board" ? 1 : 4);
      
      const pad = this.getTokenHalfSize(token);
      const rawX = tokenData.x ?? 2500;
      const rawY = tokenData.y ?? 2500;
      token.x = Math.max(pad, Math.min(5000 - pad, rawX));
      token.y = Math.max(pad, Math.min(5000 - pad, rawY));
      
      token.rotation = 0;
      token.zIndex = tokenData.type === "board" ? 1 : this.state.highestZIndex;
      token.isLocked = tokenData.isLocked || false;
      token.imageUrl = tokenData.imageUrl || ""; token.backUrl = tokenData.backUrl || "";
      token.isFaceDown = tokenData.isFaceDown || false; token.diceValue = tokenData.diceValue || 1;
      token.diceSides = tokenData.diceSides || 6; token.deckMode = tokenData.deckMode || "";
      token.sheetUrl = tokenData.sheetUrl || ""; token.cols = tokenData.cols || 0;
      token.rows = tokenData.rows || 0; token.cardIndex = tokenData.cardIndex || 0;
      
      token.label = tokenData.label || "";
      token.layerTier = tokenData.layerTier || (tokenData.type === "board" ? -1 : 0);
      
      this.state.tokens.set(id, token);
    });

    this.onMessage("spawnDeck", (client, deckData: any) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.isHost) return;

      const count = Number(deckData.cardCount) || 52;
      const scale = deckData.scale || 1;
      const pad = 70 * scale;
      const deckX = Math.max(pad, Math.min(5000 - pad, deckData.x ?? 2500));
      const deckY = Math.max(pad, Math.min(5000 - pad, deckData.y ?? 2500));

      for (let i = 1; i <= count; i++) {
        const id = `card_${Date.now()}_${i}`;
        this.state.highestZIndex += 1;
        const isSheet = deckData.deckMode === "sheet";
        const resolvedUrl = (!isSheet && (deckData.imageUrl || "").includes("{n}"))
          ? deckData.imageUrl.replace("{n}", String(i))
          : deckData.imageUrl;

        const card = new TokenSchema();
        card.id = id; card.type = "card"; card.name = `${deckData.name || "Card"} #${i}`;
        card.x = deckX; card.y = deckY; card.scale = scale; card.zIndex = this.state.highestZIndex;
        card.imageUrl = isSheet ? "" : resolvedUrl; card.backUrl = deckData.backUrl || ""; card.isFaceDown = true;
        if (isSheet) {
          card.deckMode = "sheet"; card.sheetUrl = deckData.imageUrl;
          card.cols = deckData.cols; card.rows = deckData.rows; card.cardIndex = i - 1;
        }
        this.state.tokens.set(id, card);
      }
    });

    this.onMessage("updateTokenMeta", (client, message: { id: string; scale: number; layerTier: number; label: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.isHost) return;
      const token = this.state.tokens.get(message.id);
      if (token) {
        token.scale = message.scale;
        token.layerTier = message.layerTier;
        token.label = message.label;
      }
    });

    this.onMessage("placeMat", (client, matData: { x: number; y: number; orientation: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hasPlacedMat) return;

      const id = `zone_${client.sessionId}`;
      const zone = new ZoneSchema();
      zone.id = id; zone.ownerId = client.sessionId;
      zone.width = matData.orientation === "landscape" ? 800 : 450;
      zone.height = matData.orientation === "landscape" ? 450 : 800;
      zone.x = Math.max(0, Math.min(5000 - zone.width, matData.x));
      zone.y = Math.max(0, Math.min(5000 - zone.height, matData.y));
      zone.orientation = matData.orientation; zone.color = player.color;
      zone.label = `${player.name}'s Mat`;
      this.state.zones.set(id, zone);
      player.hasPlacedMat = true;
    });

    this.onMessage("moveMat", (client, message: { id: string; dx: number; dy: number; tokenIds?: string[] }) => {
      const zone = this.state.zones.get(message.id);
      if (!zone || zone.isLocked) return;

      const mover = this.state.players.get(client.sessionId);
      const owner = this.state.players.get(zone.ownerId);
      
      if (zone.ownerId !== client.sessionId && !(mover?.isHost && (!owner || !owner.isConnected))) return;

      const newX = Math.max(0, Math.min(5000 - zone.width, zone.x + message.dx));
      const newY = Math.max(0, Math.min(5000 - zone.height, zone.y + message.dy));
      const actualDx = newX - zone.x;
      const actualDy = newY - zone.y;

      if (Array.isArray(message.tokenIds)) {
        message.tokenIds.forEach((tokenId) => {
          const token = this.state.tokens.get(tokenId);
          if (token && token.type !== "board") {
            const pad = this.getTokenHalfSize(token);
            token.x = Math.max(pad, Math.min(5000 - pad, token.x + actualDx));
            token.y = Math.max(pad, Math.min(5000 - pad, token.y + actualDy));
          }
        });
      }
      
      zone.x = newX;
      zone.y = newY;
    });

    this.onMessage("deleteTokens", (client, message: { ids: string[] }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.isHost || !Array.isArray(message.ids)) return;
      message.ids.forEach((id) => this.state.tokens.delete(id));
    });
    
    this.onMessage("deleteZone", (client, message: { id: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.isHost) return;
      const zone = this.state.zones.get(message.id);
      if (zone) {
        const owner = this.state.players.get(zone.ownerId);
        if (owner) owner.hasPlacedMat = false;
        this.state.zones.delete(message.id);
      }
    });

    this.onMessage("updateCursor", (client, message: { x: number; y: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.cursorX = message.x;
        player.cursorY = message.y;
      }
    });
  }

  onJoin(client: Client) {
    const players = Array.from(this.state.players.values()) as PlayerSchema[];
    const takenColors = players.map(p => p.color);
    const availableColor = COLOR_OPTIONS.find(c => !takenColors.includes(c)) || COLOR_OPTIONS[0];

    const player = new PlayerSchema();
    player.id = client.sessionId;
    player.color = availableColor; 
    player.isPlaying = false; 
    player.isConnected = true; 
    
    this.state.players.set(client.sessionId, player);
  }

  async onLeave(client: Client) {
    if (this.explicitQuits.has(client.sessionId)) {
      this.explicitQuits.delete(client.sessionId);
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    player.isConnected = false;

    this.state.tokens.forEach((token) => {
      if (token.selectedById === client.sessionId) token.selectedById = "";
    });

    if (!player.isPlaying) {
      this.state.players.delete(client.sessionId);
      return;
    }

    try {
      await this.allowReconnection(client, 180);
      player.isConnected = true;
      return; 
    } catch (e) {
      // Session Timed Out
    }

    const wasHost = player.isHost;
    this.state.players.delete(client.sessionId);

    if (wasHost) {
      this.ensureActiveHost();
    }
  }
}