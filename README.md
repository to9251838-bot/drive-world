# RoadWorld: Earth Drive

Responsive mobile-first driving simulator prototype.

## Deploy on Render
- Build: `pip install -r requirements.txt`
- Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`

## Environment variables
- `MONGODB_URI` (optional)
- `MONGODB_DATABASE` (optional; defaults to `roadworld`)
- `OPENWEATHER_API_KEY` (optional)
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (optional)
- `CLOUDFLARE_MODEL` (optional; defaults to `@cf/black-forest-labs/flux-1-schnell`)

## Notes
This is a starter prototype, not a finished road-physics simulator. The five garage entries currently share one sample vehicle GLB and should be replaced with licensed vehicle models. Terrain/imagery providers have their own availability, rate limits, and licensing. The Cesium token is stored in the player's browser, not on the server; restrict its permissions and usage in Cesium ion. Profile sync requires MongoDB; otherwise browser storage is used. Add authentication and rate limiting before public production use.
