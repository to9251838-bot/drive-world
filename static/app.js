(() => {
"use strict";

const $ = id => document.getElementById(id);

const KEY = {
    player: "rw-player-id",
    car: "rw-car",
    terrain: "rw-terrain",
    token: "rw-ion-token"
};

const playerId = localStorage.getItem(KEY.player) ||
    ((crypto.randomUUID && crypto.randomUUID()) ||
    ("rw-" + Date.now() + "-" + Math.random().toString(36).slice(2)));

localStorage.setItem(KEY.player, playerId);

const S = {
    lat: 32.0853,
    lon: 34.7818,
    selected: false,
    car: localStorage.getItem(KEY.car) || "sedan",
    cars: [],
    terrain: localStorage.getItem(KEY.terrain) || "global",
    speed: 0,
    gas: 0,
    brake: 0,
    steer: 0,
    heading: 0,
    cam: "chase",
    plate: "IL 4827",
    lastPlate: 0,
    skyURL: null
};

let globe = null;
let world = null;
let carModel = null;
let marker = null;
let raf = 0;
let last = 0;
let free = { x: 0, y: 0 };
let selectedDraft = S.car;

const esc = s => String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
}[c]));

async function api(url, opt = {}) {
    const r = await fetch(url, opt);
    const ct = r.headers.get("content-type") || "";
    const d = ct.includes("json") ? await r.json() : await r.text();

    if (!r.ok) {
        throw Error(d.detail || "Request failed " + r.status);
    }

    return d;
}

function coords() {
    $("selectedCoords").textContent =
        `${S.lat.toFixed(4)}°, ${S.lon.toFixed(4)}°`;

    $("gameCoords").textContent =
        `${S.lat.toFixed(4)}, ${S.lon.toFixed(4)}`;
}

function note(s) {
    $("gameNotice").textContent = s || "";
}

function status(s) {
    $("connectionStatus").textContent = "● " + s;
}

function viewerFor(id, height) {
    const v = new Cesium.Viewer(id, {
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        infoBox: false,
        selectionIndicator: false,
        fullscreenButton: false,
        shouldAnimate: false,
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        imageryProvider: false
    });

    v.imageryLayers.removeAll();

    v.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
            url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            credit: "Imagery © Esri",
            maximumLevel: 17
        })
    );

    v.scene.globe.baseColor =
        Cesium.Color.fromCssColorString("#213a4b");

    v.scene.globe.enableLighting = true;
    v.scene.skyAtmosphere.show = true;
    v.scene.globe.maximumScreenSpaceError = 2;
    v.scene.screenSpaceCameraController.minimumZoomDistance = 50;

    v.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
            S.lon,
            S.lat,
            height
        )
    });

    return v;
}

async function globalTerrain(v) {
    try {
        v.terrainProvider =
            await Cesium.CesiumTerrainProvider.fromUrl(
                "https://terrain.reearth.land/cesium-mesh/ellipsoid",
                {
                    requestVertexNormals: false,
                    requestWaterMask: false
                }
            );

        $("terrainNote").textContent =
            "Global 3D terrain enabled where available.";

    } catch (e) {
        console.warn(e);

        $("terrainNote").textContent =
            "Terrain provider unavailable; using globe ellipsoid.";
    }
}

async function cesiumTerrain() {
    // Токен хранится в переменных окружения Render.
    // Браузер получает его через серверный endpoint.
    const data = await api("/api/cesium-token");

    if (!data.token) {
        throw Error(
            "CESIUM_ION_TOKEN is not configured in Render Environment."
        );
    }

    Cesium.Ion.defaultAccessToken = data.token;

    const provider =
        await Cesium.CesiumTerrainProvider.fromIonAssetId(
            1,
            {
                requestVertexNormals: true,
                requestWaterMask: true
            }
        );

    if (globe) {
        globe.terrainProvider = provider;
    }

    if (world) {
        world.terrainProvider = provider;
    }

    S.terrain = "cesium";
    localStorage.setItem(KEY.terrain, S.terrain);

    terrainButtons();

    $("terrainNote").textContent =
        "Cesium World Terrain connected.";

    return provider;
}

function terrainButtons() {
    document.querySelectorAll("[data-terrain]").forEach(b => {
        b.classList.toggle(
            "active",
            b.dataset.terrain === S.terrain
        );
    });

    $("cesiumTokenBox").classList.toggle(
        "hidden",
        S.terrain !== "cesium"
    );
}

async function initGlobe() {
    try {
        globe = viewerFor("globe", 15000000);

        const h = new Cesium.ScreenSpaceEventHandler(
            globe.scene.canvas
        );

        h.setInputAction(m => {
            const ray = globe.camera.getPickRay(m.position);
            const p = ray && globe.scene.globe.pick(
                ray,
                globe.scene
            );

            if (!p) return;

            const c = Cesium.Cartographic.fromCartesian(p);

            S.lat = Cesium.Math.toDegrees(c.latitude);
            S.lon = Cesium.Math.toDegrees(c.longitude);
            S.selected = true;

            if (marker) {
                globe.entities.remove(marker);
            }

            marker = globe.entities.add({
                position: Cesium.Cartesian3.fromDegrees(
                    S.lon,
                    S.lat,
                    300
                ),

                point: {
                    pixelSize: 12,
                    color: Cesium.Color.fromCssColorString("#57e2c1"),
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    disableDepthTestDistance: Infinity
                },

                label: {
                    text: "START",
                    font: "bold 12px sans-serif",
                    pixelOffset: new Cesium.Cartesian2(0, -24),
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 3,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    disableDepthTestDistance: Infinity
                }
            });

            coords();

            $("startGame").disabled = false;
            $("startGame").textContent = "START DRIVE →";

        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        await globalTerrain(globe);

        if (S.terrain === "cesium") {
            try {
                await cesiumTerrain();
            } catch (e) {
                console.warn(e);
                $("terrainNote").textContent = e.message;
            }
        }

    } catch (e) {
        console.error(e);

        $("selectedCoords").textContent =
            "Map failed to load; check connection";
    }
}

async function loadCars() {
    const d = await api("/api/cars");

    S.cars = d.cars;

    renderCars();
    summary();
}

function renderCars() {
    $("carGrid").innerHTML = S.cars.map(c => `
        <article class="car-card ${c.id === selectedDraft ? "selected" : ""}"
                 data-car="${esc(c.id)}">

            <div class="car-visual" style="color:${esc(c.color)}">
                🚘
            </div>

            <div class="car-body">
                <small>${esc(c.category)}</small>
                <h3>${esc(c.name)}</h3>
                <p>Starter vehicle slot.</p>

                <button class="btn ${c.id === selectedDraft ? "primary" : "quiet"}">
                    ${c.id === selectedDraft ? "SELECTED" : "SELECT VEHICLE"}
                </button>
            </div>
        </article>
    `).join("");

    document.querySelectorAll("[data-car]").forEach(el => {
        el.addEventListener("click", () => {
            selectedDraft = el.dataset.car;
            renderCars();
        });
    });
}

function summary() {
    const c = S.cars.find(c => c.id === S.car) || S.cars[0];

    if (!c) return;

    $("selectedCarName").textContent = c.name;
    $("selectedCarSub").textContent = c.name + " selected";

    $("selectedCarCategory").textContent =
        c.category + " · Active vehicle";

    $("selectedCarBadge").textContent = c.id.toUpperCase();
}

async function profileLoad() {
    try {
        const p = await api(
            "/api/profile/" + encodeURIComponent(playerId)
        );

        if (S.cars.some(c => c.id === p.selected_car)) {
            S.car = p.selected_car;
            selectedDraft = S.car;

            localStorage.setItem(KEY.car, S.car);

            summary();
        }
    } catch (e) {
        console.warn(e);
    }
}

async function profileSave() {
    try {
        const d = await api("/api/profile", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                player_id: playerId,
                selected_car: selectedDraft
            })
        });

        S.car = selectedDraft;

        localStorage.setItem(KEY.car, S.car);

        summary();

        $("garageStatus").textContent =
            d.storage === "mongodb"
                ? "Saved to MongoDB profile."
                : "Saved in this browser. Add MONGODB_URI for cross-device sync.";

    } catch (e) {
        S.car = selectedDraft;

        localStorage.setItem(KEY.car, S.car);

        summary();

        $("garageStatus").textContent =
            "Saved locally; server sync failed: " + e.message;
    }

    renderCars();
}

function show(name) {
    $("menuScreen").classList.toggle("hidden", name !== "menu");
    $("garageScreen").classList.toggle("hidden", name !== "garage");
    $("gameScreen").classList.toggle("hidden", name !== "game");

    setTimeout(() => {
        if (name === "menu" && globe) globe.resize();
        if (name === "game" && world) world.resize();
    }, 80);
}

function openGarage() {
    selectedDraft = S.car;

    renderCars();

    $("garageStatus").textContent =
        "Choose a vehicle and save it.";

    show("garage");
}

let groundHeight = 0;
let lastGroundSample = 0;
let groundSampleBusy = false;

function matrix() {
    // Приподнимаем модель над поверхностью земли.
    const lift = 2.2;

    const pos = Cesium.Cartesian3.fromDegrees(
        S.lon,
        S.lat,
        Math.max(0, groundHeight) + lift
    );

    const hpr = new Cesium.HeadingPitchRoll(
        Cesium.Math.toRadians(S.heading),
        0,
        0
    );

    return Cesium.Transforms.headingPitchRollToFixedFrame(
        pos,
        hpr
    );
}

async function sampleGroundHeight(force = false) {
    if (
        !world ||
        groundSampleBusy ||
        (!force && Date.now() - lastGroundSample < 1200)
    ) {
        return;
    }

    groundSampleBusy = true;
    lastGroundSample = Date.now();

    try {
        const provider = world.terrainProvider;

        const point = Cesium.Cartographic.fromDegrees(
            S.lon,
            S.lat
        );

        if (
            provider &&
            typeof Cesium.sampleTerrainMostDetailed === "function"
        ) {
            const sampled =
                await Cesium.sampleTerrainMostDetailed(
                    provider,
                    [point]
                );

            if (
                sampled &&
                Number.isFinite(sampled[0].height)
            ) {
                groundHeight = sampled[0].height;
            }
        }

    } catch (e) {
        console.debug(
            "Terrain height sample unavailable; using safe vehicle lift",
            e
        );

    } finally {
        groundSampleBusy = false;

        if (carModel) {
            carModel.modelMatrix = matrix();
        }
    }
}

async function start() {
    if (!S.selected) {
        note("Select a point on the globe first.");
        return;
    }

    show("game");

    note("Loading terrain and vehicle…");

    if (world) {
        world.destroy();
        world = null;
        carModel = null;
    }

    groundHeight = 0;
    lastGroundSample = 0;

    try {
        world = viewerFor("gameWorld", 180);

        if (S.terrain === "cesium") {
            try {
                await cesiumTerrain();

            } catch (e) {
                console.warn(
                    "Cesium terrain unavailable",
                    e
                );

                await globalTerrain(world);

                note(
                    "Cesium token/terrain unavailable; using global terrain."
                );
            }

        } else {
            await globalTerrain(world);
        }

        await sampleGroundHeight(true);

        const car =
            S.cars.find(c => c.id === S.car) || S.cars[0];

        try {
            carModel = await Cesium.Model.fromGltfAsync({
                url: car.model_url,
                modelMatrix: matrix(),
                scale: 1,
                minimumPixelSize: 65,
                maximumScale: 100,
                allowPicking: false,
                clampAnimations: true
            });

            world.scene.primitives.add(carModel);

            await sampleGroundHeight(true);

        } catch (e) {
            console.warn("GLB unavailable", e);

            world.entities.add({
                position: Cesium.Cartesian3.fromDegrees(
                    S.lon,
                    S.lat,
                    Math.max(0, groundHeight) + 1.2
                ),

                box: {
                    dimensions: new Cesium.Cartesian3(
                        4,
                        1.8,
                        1.3
                    ),

                    material: Cesium.Color.fromCssColorString(
                        car.color
                    )
                }
            });

            note(
                "3D model unavailable; using demo vehicle."
            );
        }

        world.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(
                S.lon,
                S.lat,
                Math.max(groundHeight, 0) + 70
            ),

            orientation: {
                heading: Cesium.Math.toRadians(S.heading),
                pitch: Cesium.Math.toRadians(-18),
                roll: 0
            }
        });

        await weatherSky();
        await plate(true);

        coords();

        $("gameLocation").textContent =
            S.weatherName || "Earth";

        loop();

    } catch (e) {
        console.error(e);

        note("World setup issue: " + e.message);
    }
}

async function weatherSky() {
    try {
        const w = await api(
            `/api/weather?lat=${S.lat}&lon=${S.lon}`
        );

        S.weatherName = w.name || "Earth";

        const desc =
            w.weather?.[0]?.description || "clear sky";

        const now = new Date();

        const season = [
            "winter", "winter",
            "spring", "spring", "spring",
            "summer", "summer", "summer",
            "autumn", "autumn", "autumn",
            "winter"
        ][now.getMonth()];

        const time =
            now.getHours() < 6 || now.getHours() > 20
                ? "night"
                : now.getHours() < 10
                    ? "morning"
                    : now.getHours() > 17
                        ? "sunset"
                        : "day";

        note("Generating local sky…");

        const r = await fetch("/api/sky", {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                lat: S.lat,
                lon: S.lon,
                weather: desc,
                season,
                local_time: time
            })
        });

        if (r.ok) {
            const blob = await r.blob();

            if (S.skyURL) {
                URL.revokeObjectURL(S.skyURL);
            }

            S.skyURL = URL.createObjectURL(blob);

            world.imageryLayers.addImageryProvider(
                new Cesium.SingleTileImageryProvider({
                    url: S.skyURL
                }),
                1
            );

            note("");

        } else {
            const b = await r.json().catch(() => ({}));

            note(b.detail || "Sky AI not configured");

            setTimeout(() => note(""), 2500);
        }

    } catch (e) {
        console.warn("Weather/sky unavailable", e);

        $("gameLocation").textContent =
            "Earth · weather offline";
    }
}

async function plate(force) {
    if (
        !force &&
        Date.now() - S.lastPlate < 120000
    ) {
        return;
    }

    S.lastPlate = Date.now();

    try {
        const d = await api(
            `/api/plate?lat=${S.lat}&lon=${S.lon}`
        );

        S.plate = d.plate;

        $("plateReadout").textContent = S.plate;

    } catch (e) {
        console.warn(e);
    }
}

function camera() {
    if (!world) return;

    const pos = Cesium.Cartesian3.fromDegrees(
        S.lon,
        S.lat,
        Math.max(0, groundHeight) + 1.5
    );

    const heading = Cesium.Math.toRadians(S.heading);

    let range;

    if (S.cam === "free") {
        range = new Cesium.HeadingPitchRange(
            heading + Math.PI +
                Cesium.Math.toRadians(free.x),

            Cesium.Math.toRadians(-18 + free.y),
            35
        );

    } else if (S.cam === "cockpit") {
        range = new Cesium.HeadingPitchRange(
            heading,
            Cesium.Math.toRadians(-3),
            4
        );

    } else if (S.cam === "top") {
        range = new Cesium.HeadingPitchRange(
            0,
            Cesium.Math.toRadians(-89),
            90
        );

    } else {
        range = new Cesium.HeadingPitchRange(
            heading + Math.PI,
            Cesium.Math.toRadians(-16),
            22
        );
    }

    world.camera.lookAt(pos, range);

    world.camera.lookAtTransform(
        Cesium.Matrix4.IDENTITY
    );
}

function loop() {
    cancelAnimationFrame(raf);

    last = performance.now();

    function tick(now) {
        const dt = Math.min(
            0.05,
            (now - last) / 1000 || 0
        );

        last = now;

        if (
            world &&
            !$("gameScreen").classList.contains("hidden")
        ) {
            drive(dt);
        }

        raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
}

function drive(dt) {
    S.speed = S.gas
        ? Math.min(110, S.speed + 25 * S.gas * dt)
        : Math.max(0, S.speed - 2 * dt);

    if (S.brake) {
        S.speed = Math.max(
            0,
            S.speed - 60 * S.brake * dt
        );
    }

    S.heading = (
        S.heading +
        S.steer * (18 + S.speed * 0.22) * dt +
        360
    ) % 360;

    const m = S.speed / 3.6 * dt;
    const h = Cesium.Math.toRadians(S.heading);

    S.lat += m * Math.cos(h) / 111320;

    S.lon += m * Math.sin(h) /
        (
            111320 *
            Math.max(
                0.12,
                Math.cos(
                    Cesium.Math.toRadians(S.lat)
                )
            )
        );

    S.lon = ((S.lon + 180) % 360 + 360) % 360 - 180;

    if (carModel) {
        carModel.modelMatrix = matrix();
    }

    if (Date.now() - lastGroundSample > 1200) {
        sampleGroundHeight(false);
    }

    $("speedReadout").textContent = Math.round(S.speed);

    coords();
    camera();

    world.scene.requestRender();

    if (Date.now() - S.lastPlate > 120000) {
        plate(false);
    }
}

function pedal(id, key) {
    const el = $(id);

    if (!el) {
        console.warn(`Control element not found: ${id}`);
        return;
    }

    const down = e => {
        e.preventDefault();

        S[key] = 1;
        el.classList.add("pressed");

        try {
            el.setPointerCapture(e.pointerId);
        } catch (_) {}
    };

    const up = () => {
        S[key] = 0;
        el.classList.remove("pressed");
    };

    el.addEventListener("pointerdown", down);

    [
        "pointerup",
        "pointercancel",
        "pointerleave",
        "lostpointercapture"
    ].forEach(ev => el.addEventListener(ev, up));
}

function joystick() {
    const pad = $("joystick");
    const knob = $("joystickKnob");

    if (!pad || !knob) {
        console.warn("Joystick elements not found.");
        return;
    }

    let active = false;
    let pid = null;

    function move(e) {
        const r = pad.getBoundingClientRect();

        let dx = e.clientX - (r.left + r.width / 2);
        let dy = e.clientY - (r.top + r.height / 2);

        const max = r.width * 0.28;
        const d = Math.hypot(dx, dy);

        if (d > max) {
            dx = dx / d * max;
            dy = dy / d * max;
        }

        knob.style.transform =
            `translate(${dx}px, ${dy}px)`;

        S.steer = Math.max(
            -1,
            Math.min(1, dx / max)
        );
    }

    pad.addEventListener("pointerdown", e => {
        e.preventDefault();

        active = true;
        pid = e.pointerId;

        try {
            pad.setPointerCapture(pid);
        } catch (_) {}

        move(e);
    });

    pad.addEventListener("pointermove", e => {
        if (active && e.pointerId === pid) {
            move(e);
        }
    });

    [
        "pointerup",
        "pointercancel",
        "lostpointercapture"
    ].forEach(ev => {
        pad.addEventListener(ev, () => {
            active = false;
            pid = null;
            S.steer = 0;
            knob.style.transform = "translate(0, 0)";
        });
    });
}

function bind() {
    $("openGarage").onclick = openGarage;
    $("changeCar").onclick = openGarage;

    $("backFromGarage").onclick = () => show("menu");

    $("saveCar").onclick = profileSave;

    $("startGame").onclick = start;

    $("exitGame").onclick = () => {
        cancelAnimationFrame(raf);
        show("menu");
    };

    $("toggleFreeCamera").onclick = () => {
        setCamera(
            S.cam === "free" ? "chase" : "free"
        );
    };

    $("locateMe").onclick = () => {
        if (!navigator.geolocation) {
            alert("Location is unavailable in this browser.");
            return;
        }

        navigator.geolocation.getCurrentPosition(
            p => {
                S.lat = p.coords.latitude;
                S.lon = p.coords.longitude;
                S.selected = true;

                if (globe) {
                    globe.camera.flyTo({
                        destination: Cesium.Cartesian3.fromDegrees(
                            S.lon,
                            S.lat,
                            90000
                        )
                    });
                }

                if ($("startGame")) {
                    $("startGame").disabled = false;
                    $("startGame").textContent = "START DRIVE →";
                }

                coords();
            },

            () => {
                alert(
                    "Allow location access or tap a point on the globe."
                );
            },

            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 10000
            }
        );
    };

    document.querySelectorAll("[data-terrain]").forEach(b => {
        b.onclick = async () => {
            S.terrain = b.dataset.terrain;

            localStorage.setItem(
                KEY.terrain,
                S.terrain
            );

            terrainButtons();

            if (S.terrain === "global") {
                if (globe) {
                    await globalTerrain(globe);
                }

                if (world) {
                    await globalTerrain(world);
                }

            } else {
                try {
                    await cesiumTerrain();

                    if (world) {
                        await sampleGroundHeight(true);
                    }

                } catch (e) {
                    console.error(e);

                    $("terrainNote").textContent = e.message;

                    alert(
                        "Could not connect Cesium terrain: " +
                        e.message
                    );
                }
            }
        };
    });

    const applyTokenButton = $("applyToken");

    if (applyTokenButton) {
        applyTokenButton.onclick = async () => {
            try {
                await cesiumTerrain();

                if (world) {
                    await sampleGroundHeight(true);
                }

                alert("Cesium terrain connected successfully.");

            } catch (e) {
                alert(e.message);
            }
        };
    }

    document.querySelectorAll("[data-camera]").forEach(b => {
        b.onclick = () => setCamera(b.dataset.camera);
    });

    pedal("gas", "gas");
    pedal("brake", "brake");

    joystick();

    let drag = null;

    const gameWorld = $("gameWorld");

    if (gameWorld) {
        gameWorld.addEventListener("pointerdown", e => {
            if (S.cam === "free") {
                drag = {
                    x: e.clientX,
                    y: e.clientY
                };
            }
        });

        gameWorld.addEventListener("pointermove", e => {
            if (!drag || S.cam !== "free") {
                return;
            }

            free.x += (e.clientX - drag.x) * 0.35;

            free.y = Math.max(
                -55,
                Math.min(
                    30,
                    free.y + (e.clientY - drag.y) * 0.2
                )
            );

            drag = {
                x: e.clientX,
                y: e.clientY
            };
        });

        [
            "pointerup",
            "pointercancel",
            "pointerleave"
        ].forEach(ev => {
            gameWorld.addEventListener(ev, () => {
                drag = null;
            });
        });
    }

    window.addEventListener("resize", () => {
        if (globe) {
            globe.resize();
        }

        if (world) {
            world.resize();
        }
    });

    window.addEventListener("orientationchange", () => {
        setTimeout(() => {
            if (globe) {
                globe.resize();
            }

            if (world) {
                world.resize();
            }
        }, 250);
    });

    document.addEventListener("keydown", e => {
        if (
            $("gameScreen").classList.contains("hidden")
        ) {
            return;
        }

        const key = e.key.toLowerCase();

        if (e.key === "ArrowLeft" || key === "a") {
            S.steer = -1;
        }

        if (e.key === "ArrowRight" || key === "d") {
            S.steer = 1;
        }

        if (e.key === "ArrowUp" || key === "w") {
            S.gas = 1;
        }

        if (e.key === "ArrowDown" || key === "s") {
            S.brake = 1;
        }
    });

    document.addEventListener("keyup", e => {
        const key = e.key.toLowerCase();

        if (
            ["arrowleft", "arrowright", "a", "d"].includes(key)
        ) {
            S.steer = 0;
        }

        if (
            ["arrowup", "w"].includes(key)
        ) {
            S.gas = 0;
        }

        if (
            ["arrowdown", "s"].includes(key)
        ) {
            S.brake = 0;
        }
    });

    // Prevent controls remaining active when the tab loses focus.
    window.addEventListener("blur", () => {
        S.gas = 0;
        S.brake = 0;
        S.steer = 0;
    });
}

function setCamera(mode) {
    S.cam = mode;

    document.querySelectorAll("[data-camera]").forEach(b => {
        b.classList.toggle(
            "active",
            b.dataset.camera === mode
        );
    });

    const freeCameraButton = $("toggleFreeCamera");

    if (freeCameraButton) {
        freeCameraButton.textContent =
            mode === "free" ? "EXIT FREE CAM" : "FREE CAM";
    }

    note(
        mode === "free"
            ? "Drag the map to look around."
            : ""
    );
}

async function init() {
    bind();
    terrainButtons();

    try {
        const config = await api("/api/config");

        status(
            config.mongodb_configured
                ? "PROFILE SYNC READY"
                : "SYSTEM READY"
        );

    } catch (e) {
        console.warn("Could not load configuration:", e);
        status("LOCAL MODE");
    }

    try {
        await loadCars();
        await profileLoad();

        selectedDraft = S.car;

        renderCars();
        summary();

        await initGlobe();

        coords();

    } catch (e) {
        console.error("Initialization error:", e);
        status("PARTIAL MODE");
    }
}

init();
