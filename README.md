# Continue from Hospital

Four-player fantasy zombie RP prototype for Rot 2041. The game now starts inside Mercy General Hospital before the outbreak is understood.

## Run

```powershell
node .\server.mjs
```

Open the printed URL, usually:

```text
http://localhost:8787
```

Use multiple tabs or devices on the same server URL. One player creates a room, then the other players join with the `ROT-XXXX` code.

## OpenAI GM

Put your OpenAI API key in a local `.env` file beside `server.mjs`:

```text
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
```

The browser never receives the OpenAI key. The server calls the OpenAI Responses API from `server.mjs`. If no key is present, the local GM resolver stays active as a fallback.

## Liveblocks

Liveblocks is not required for the current local WebSocket prototype. The reserved key locations are:

```text
LIVEBLOCKS_PUBLIC_KEY=your_public_key_here
LIVEBLOCKS_SECRET_KEY=your_secret_key_here
```

Those values are already included in `.env.example` for the later Liveblocks realtime adapter.

## What is built

- Four-player room codes with max four character slots.
- Hospital outbreak start instead of armed clinic entry.
- Different starting rooms and emotional baggage for each player.
- Personal NPCs that matter to each player.
- Face-claim upload during character creation, shown on player cards.
- Stats with icons: Health, Stress, Energy, Hunger, Thirst, Injury.
- No starting firearms or ammo.
- Fixed story panel with inner narration scrolling.
- Bottom action drawer.
- Inventory drawer split into body items and backpack.
- Suspense audio generated in-browser with ambient pulses and stingers.
- Shared player posts in the story panel, then GM narration moves the scene.
- OpenAI GM adapter with local fallback.
