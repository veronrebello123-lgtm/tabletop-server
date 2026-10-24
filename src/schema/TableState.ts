import { Schema, MapSchema, type, ArraySchema } from "@colyseus/schema";

export class TokenSchema extends Schema {
  @type("string") id = "";
  @type("string") type = "";
  @type("string") name = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") rotation = 0;
  @type("number") scale = 1;
  @type("number") zIndex = 0;
  @type("boolean") isLocked = false;
  @type("string") imageUrl = "";
  @type("string") backUrl = "";
  @type("boolean") isFaceDown = false;
  @type("number") diceValue = 1;
  @type("number") diceSides = 6;
  @type("string") deckMode = "";
  @type("string") sheetUrl = "";
  @type("number") cols = 0;
  @type("number") rows = 0;
  @type("number") cardIndex = 0;
  @type("string") selectedById = "";
  @type([ TokenSchema ]) contents = new ArraySchema<TokenSchema>();
  
  // Inspector Metadata
  @type("string") label = "";
  @type("number") layerTier = 0; // -1: Background, 0: Normal, 1: Foreground
}

export class ZoneSchema extends Schema {
  @type("string") id = "";
  @type("string") ownerId = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") width = 0;
  @type("number") height = 0;
  @type("string") orientation = "landscape";
  @type("number") color = 0x22c55e;
  @type("string") label = "";
  @type("boolean") isLocked = false;
  @type("boolean") isHidden = false;
}

export class PlayerSchema extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("number") color = 0x22c55e;
  @type("boolean") isHost = false;
  @type("boolean") hasPlacedMat = false;
  @type("boolean") isPlaying = false;
  @type("boolean") isConnected = false;
  @type("number") cursorX = 2500;
  @type("number") cursorY = 2500;
}

export class TableState extends Schema {
  @type({ map: TokenSchema }) tokens = new MapSchema<TokenSchema>();
  @type({ map: ZoneSchema }) zones = new MapSchema<ZoneSchema>();
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type("number") highestZIndex = 0;
}