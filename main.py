import os, random, datetime, base64
from typing import Optional
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
try:
    from pymongo import MongoClient
except ImportError:
    MongoClient = None

app = FastAPI(title="RoadWorld: Earth Drive")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")
DB = None
if os.getenv("MONGODB_URI") and MongoClient:
    try:
        DB = MongoClient(os.environ["MONGODB_URI"], serverSelectionTimeoutMS=2500)[os.getenv("MONGODB_DATABASE","roadworld")]
    except Exception as e: print("MongoDB setup:", e)
OW_KEY = os.getenv("OPENWEATHER_API_KEY","")
CF_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID","")
CF_TOKEN = os.getenv("CLOUDFLARE_API_TOKEN","")
CF_MODEL = os.getenv("CLOUDFLARE_MODEL","@cf/black-forest-labs/flux-1-schnell")

CARS = [
 {"id":"coupe","name":"Sports Coupe","category":"Sport","color":"#e45d59","model_url":"https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/GroundVehicle/GroundVehicle.glb"},
 {"id":"sedan","name":"Modern Sedan","category":"Street","color":"#4385d1","model_url":"https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/GroundVehicle/GroundVehicle.glb"},
 {"id":"suv","name":"Off-Road SUV","category":"Off-road","color":"#4e9b73","model_url":"https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/GroundVehicle/GroundVehicle.glb"},
 {"id":"supercar","name":"Supercar","category":"Performance","color":"#b46ad7","model_url":"https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/GroundVehicle/GroundVehicle.glb"},
 {"id":"classic","name":"Classic Coupe","category":"Classic","color":"#d4a64e","model_url":"https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/GroundVehicle/GroundVehicle.glb"},
]
class Profile(BaseModel):
    player_id: str = Field(min_length=8, max_length=100)
    selected_car: str
class Sky(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    weather: str = "clear sky"
    season: str = "unknown"
    local_time: str = "day"

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request":request})
@app.get("/health")
async def health(): return {"status":"ok","service":"roadworld-earth-drive"}
@app.get("/api/config")
async def config():
    return {"status":"ok","mongodb_configured":DB is not None,"openweather_configured":bool(OW_KEY),"cloudflare_configured":bool(CF_ID and CF_TOKEN)}
@app.get("/api/cars")
async def cars(): return {"cars":CARS}
@app.get("/api/profile/{player_id}")
async def get_profile(player_id:str):
    if DB is not None:
        try:
            doc=DB.profiles.find_one({"player_id":player_id},{"_id":0})
            if doc:return doc
        except Exception as e: print("Profile read:",e)
    return {"player_id":player_id,"selected_car":"sedan"}
@app.put("/api/profile")
async def save_profile(p:Profile):
    if p.selected_car not in {c["id"] for c in CARS}: raise HTTPException(400,"Unknown car")
    doc={"player_id":p.player_id,"selected_car":p.selected_car,"updated_at":datetime.datetime.now(datetime.timezone.utc).isoformat()}
    if DB is not None:
        try:
            DB.profiles.update_one({"player_id":p.player_id},{"$set":doc},upsert=True)
            return {"status":"saved","storage":"mongodb",**doc}
        except Exception as e:
            print("Profile write:",e); raise HTTPException(503,"MongoDB profile save failed")
    return {"status":"local_fallback","storage":"browser",**doc}
@app.get("/api/weather")
async def weather(lat:float,lon:float):
    if not OW_KEY: raise HTTPException(503,"Set OPENWEATHER_API_KEY in Render")
    async with httpx.AsyncClient(timeout=15) as c:
        r=await c.get("https://api.openweathermap.org/data/2.5/weather",params={"lat":lat,"lon":lon,"appid":OW_KEY,"units":"metric"})
    if r.status_code>=400: raise HTTPException(r.status_code,"OpenWeather request failed")
    return r.json()
@app.post("/api/sky")
async def sky(p:Sky):
    if not (CF_ID and CF_TOKEN): raise HTTPException(503,"Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN")
    prompt=f"Photorealistic wide driving-simulator sky panorama, latitude {p.lat:.3f}, longitude {p.lon:.3f}, season {p.season}, local time {p.local_time}, weather {p.weather}; natural clouds and atmospheric perspective, no text, no cars."
    url=f"https://api.cloudflare.com/client/v4/accounts/{CF_ID}/ai/run/{CF_MODEL}"
    async with httpx.AsyncClient(timeout=90) as c:
        r=await c.post(url,headers={"Authorization":f"Bearer {CF_TOKEN}"},json={"prompt":prompt,"num_steps":4})
    if r.status_code>=400: raise HTTPException(r.status_code,"Cloudflare AI request failed")
    if "image/" in r.headers.get("content-type",""): return Response(r.content,media_type=r.headers["content-type"])
    try:
        data=r.json(); image=data.get("result",{}).get("image")
        if image:return Response(base64.b64decode(image),media_type="image/png")
    except Exception: pass
    raise HTTPException(502,"Could not read generated image response")
@app.get("/api/plate")
async def plate(lat:float,lon:float):
    async with httpx.AsyncClient(timeout=10,headers={"User-Agent":"RoadWorldEarthDrive/1.0"}) as c:
        r=await c.get("https://nominatim.openstreetmap.org/reverse",params={"format":"jsonv2","lat":lat,"lon":lon,"zoom":3})
    if r.status_code>=400: raise HTTPException(502,"Country lookup failed")
    country=(r.json().get("address",{}).get("country_code") or "xx").upper()
    letters=lambda n:"".join(random.choices("ABCDEFGHJKLMNPRSTUVWXYZ",k=n))
    patterns={"IL":lambda:f"{random.randint(10,99)}-{random.randint(100,999)}-{random.randint(10,99)}","US":lambda:f"{letters(3)}-{random.randint(1000,9999)}","GB":lambda:f"{letters(2)}{random.randint(10,99)} {letters(3)}","DE":lambda:f"{letters(2)} {random.randint(100,9999)}","FR":lambda:f"{letters(2)}-{random.randint(100,999)}-{letters(2)}"}
    return {"country_code":country,"plate":patterns.get(country,lambda:f"{country} {random.randint(1000,9999)}")()}
