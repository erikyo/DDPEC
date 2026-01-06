import type { Band } from "./main.ts";

/**
 * CONFIG & CONSTANTS
 */
const CONFIG = {
    minFreq: 20,
    maxFreq: 20000,
    minGain: -20,
    gainRange: 20,
    padding: 40,
};

/**
 * STATE MANAGEMENT
 */
let localBands: Band[] = [];
let selectedIndex: number | null = null;
let draggingIndex: number | null = null;
let onUpdateCallback: ((index: number, key: string, value: number | string | boolean) => void) | null = null;

// DOM Elements
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let bandList: HTMLElement | null = null;
let controlsArea: HTMLElement | null = null;

const inputs = {
    type: null as HTMLSelectElement | null,
    freq: null as HTMLInputElement | null,
    gain: null as HTMLInputElement | null,
    q: null as HTMLInputElement | null,
    bypass: null as HTMLInputElement | null,
};

const labels = {
    freq: null as HTMLElement | null,
    gain: null as HTMLElement | null,
    q: null as HTMLElement | null,
    id: null as HTMLElement | null,
};

/**
 * MATH & DSP CORE (RBJ Audio EQ Cookbook)
 */

function freqToX(freq: number, width: number) {
    const logMin = Math.log10(CONFIG.minFreq);
    const logMax = Math.log10(CONFIG.maxFreq);
    const logFreq = Math.log10(Math.max(freq, CONFIG.minFreq));
    return CONFIG.padding + ((logFreq - logMin) / (logMax - logMin)) * (width - 2 * CONFIG.padding);
}

function xToFreq(x: number, width: number) {
    const logMin = Math.log10(CONFIG.minFreq);
    const logMax = Math.log10(CONFIG.maxFreq);
    const ratio = (x - CONFIG.padding) / (width - 2 * CONFIG.padding);
    return Math.pow(10, logMin + ratio * (logMax - logMin));
}

function gainToY(gain: number, height: number) {
    return height / 2 - (gain / CONFIG.gainRange) * (height / 2 - CONFIG.padding);
}

function yToGain(y: number, height: number) {
    return -(y - height / 2) * CONFIG.gainRange / (height / 2 - CONFIG.padding);
}

function calculateBiquad(band: Band, sampleRate: number = 48000) {
    if (!band.enabled) {
        return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
    }

    const w0 = 2 * Math.PI * band.freq / sampleRate;
    const alpha = Math.sin(w0) / (2 * band.q);
    const A = Math.pow(10, band.gain / 40);
    const cosw = Math.cos(w0);

    let b0, b1, b2, a0, a1, a2;

    switch (band.type) {
        case "PK": // Peak
            b0 = 1 + alpha * A;
            b1 = -2 * cosw;
            b2 = 1 - alpha * A;
            a0 = 1 + alpha / A;
            a1 = -2 * cosw;
            a2 = 1 - alpha / A;
            break;
        case "LSQ": // Low Shelf
            const sa = 2 * Math.sqrt(A) * alpha;
            b0 = A * ((A + 1) - (A - 1) * cosw + sa);
            b1 = 2 * A * ((A - 1) - (A + 1) * cosw);
            b2 = A * ((A + 1) - (A - 1) * cosw - sa);
            a0 = (A + 1) + (A - 1) * cosw + sa;
            a1 = -2 * ((A - 1) + (A + 1) * cosw);
            a2 = (A + 1) + (A - 1) * cosw - sa;
            break;
        case "HSQ": // High Shelf
            const sb = 2 * Math.sqrt(A) * alpha;
            b0 = A * ((A + 1) + (A - 1) * cosw + sb);
            b1 = -2 * A * ((A - 1) + (A + 1) * cosw);
            b2 = A * ((A + 1) + (A - 1) * cosw - sb);
            a0 = (A + 1) - (A - 1) * cosw + sb;
            a1 = 2 * ((A - 1) - (A + 1) * cosw);
            a2 = (A + 1) - (A - 1) * cosw - sb;
            break;
        default:
            b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0;
            break;
    }

    return {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
    };
}

function getMagnitude(freq: number, coeffsList: any[], sampleRate: number = 48000) {
    const w = 2 * Math.PI * freq / sampleRate;
    const cos1 = Math.cos(w);
    const cos2 = Math.cos(2 * w);
    const sin1 = Math.sin(w);
    const sin2 = Math.sin(2 * w);

    let totalDb = 0;

    coeffsList.forEach((c) => {
        const numRe = c.b0 + c.b1 * cos1 + c.b2 * cos2;
        const numIm = -(c.b1 * sin1 + c.b2 * sin2);
        const denRe = 1 + c.a1 * cos1 + c.a2 * cos2;
        const denIm = -(c.a1 * sin1 + c.a2 * sin2);

        const magSq = (numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm);
        totalDb += 10 * Math.log10(magSq);
    });

    return totalDb;
}

/**
 * RENDERING
 */
export function resizeCanvas() {
    if (!canvas || !ctx) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    // Use canvas's own measurement. Since we rely on CSS (w-full h-full) to size it within the parent,
    // canvas.getBoundingClientRect() returns the exact displayed size (excluding parent borders).
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Use Math.round to ensure integer buffer dimensions
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    ctx.scale(dpr, dpr);

    // Update logical size to match the display size used for calculation
    (canvas as any).logicalWidth = rect.width;
    (canvas as any).logicalHeight = rect.height;

    draw();
}

function drawGrid(c: CanvasRenderingContext2D, width: number, height: number) {
    c.strokeStyle = "#334155";
    c.lineWidth = 1;
    c.font = "10px monospace";
    c.fillStyle = "#94a3b8";
    c.textAlign = "right";

    for (let g = -CONFIG.gainRange; g <= CONFIG.gainRange; g += 6) {
        const y = gainToY(g, height);
        c.beginPath();
        c.moveTo(CONFIG.padding, y);
        c.lineTo(width - CONFIG.padding, y);
        c.stroke();
        if (g !== 0) c.fillText(`${g}dB`, CONFIG.padding - 5, y + 3);
    }

    const zeroY = gainToY(0, height);
    c.strokeStyle = "#475569";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(CONFIG.padding, zeroY);
    c.lineTo(width - CONFIG.padding, zeroY);
    c.stroke();

    const freqs = [30, 60, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    c.strokeStyle = "#334155";
    c.lineWidth = 1;
    c.textAlign = "center";

    freqs.forEach((f) => {
        const x = freqToX(f, width);
        c.beginPath();
        c.moveTo(x, CONFIG.padding);
        c.lineTo(x, height - CONFIG.padding);
        c.stroke();
        c.fillText(f >= 1000 ? `${f / 1000}k` : f.toString(), x, height - CONFIG.padding + 15);
    });
}

function drawCurve(c: CanvasRenderingContext2D, width: number, height: number) {
    const activeCoeffs = localBands.map(b => calculateBiquad(b));

    c.beginPath();
    c.strokeStyle = "#4ade80"; // Green-400
    c.lineWidth = 3;
    c.shadowBlur = 10;
    c.shadowColor = "rgba(74, 222, 128, 0.3)";

    const endX = width - CONFIG.padding;
    const startX = CONFIG.padding;

    for (let i = 0; i <= (endX - startX); i++) {
        const x = startX + i;
        const freq = xToFreq(x, width);
        const totalGain = getMagnitude(freq, activeCoeffs);
        const y = gainToY(totalGain, height);

        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
    }
    c.stroke();
    c.shadowBlur = 0;
}

function drawHandles(c: CanvasRenderingContext2D, width: number, height: number) {
    localBands.forEach((band) => {
        // Draw even if disabled, but dim

        const x = freqToX(band.freq, width);
        const y = gainToY(band.gain, height);
        const isSelected = band.index === selectedIndex;
        const isDisabled = !band.enabled;

        c.beginPath();
        c.arc(x, y, isSelected ? 8 : 6, 0, 2 * Math.PI);

        if (isDisabled) {
            c.fillStyle = isSelected ? "#b45309" : "rgba(100, 100, 100, 0.5)";
        } else {
            c.fillStyle = isSelected ? "#fbbf24" : "rgba(96, 165, 250, 0.8)";
        }

        c.strokeStyle = isDisabled ? "#444" : "#1e3a8a";
        c.lineWidth = 2;
        c.fill();
        c.stroke();
    });
}

function draw() {
    if (!canvas || !ctx) return;
    const width = (canvas as any).logicalWidth || canvas.width;
    const height = (canvas as any).logicalHeight || canvas.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid(ctx, width, height);
    drawCurve(ctx, width, height);
    drawHandles(ctx, width, height);
}


/**
 * UI UPDATES
 */

function updateControls() {
    if (!controlsArea) return;

    if (selectedIndex === null) {
        controlsArea.classList.add("hidden");
        return;
    }

    const band = localBands[selectedIndex];
    if (!band) return;

    controlsArea.classList.remove("hidden");

    if (labels.id) labels.id.textContent = `#${band.index + 1}`;

    if (inputs.type) inputs.type.value = band.type;

    if (inputs.freq && labels.freq) {
        const logMin = Math.log10(CONFIG.minFreq);
        const logMax = Math.log10(CONFIG.maxFreq);
        inputs.freq.min = logMin.toString();
        inputs.freq.max = logMax.toString();
        inputs.freq.step = "0.001";
        inputs.freq.value = Math.log10(band.freq).toString();
        labels.freq.textContent = Math.round(band.freq) + "Hz";
    }

    if (inputs.gain && labels.gain) {
        inputs.gain.min = (-CONFIG.gainRange).toString();
        inputs.gain.max = (CONFIG.gainRange).toString();
        inputs.gain.value = band.gain.toString();
        labels.gain.textContent = band.gain.toFixed(1) + "dB";
    }

    if (inputs.q && labels.q) {
        inputs.q.value = band.q.toString();
        labels.q.textContent = band.q.toFixed(2);
    }

    if (inputs.bypass) {
        inputs.bypass.checked = band.enabled;
    }
}

function updateList() {
    if (!bandList) return;
    bandList.innerHTML = "";

    localBands.forEach(band => {
        const div = document.createElement("div");
        const isSelected = band.index === selectedIndex;
        div.className = `p-3 rounded flex justify-between items-center cursor-pointer transition-colors border-l-4 ${isSelected
            ? "bg-gray-700 border-blue-500"
            : "bg-gray-800 border-transparent hover:bg-gray-700"
            } ${!band.enabled ? "opacity-60" : ""}`;

        div.innerHTML = `
            <div class="text-sm">
                <div class="font-mono font-bold text-gray-200">Band ${band.index + 1}: ${band.type}</div>
                <div class="text-xs text-gray-400">${Math.round(band.freq)}Hz · ${band.gain}dB</div>
            </div>
            <div class="flex gap-2">
                 <div class="w-3 h-3 rounded-full ${band.enabled ? "bg-green-500 shadow-[0_0_5px_rgba(74,222,128,0.5)]" : "bg-gray-600"}"></div>
            </div>
        `;
        div.onclick = () => selectBand(band.index);
        bandList!.appendChild(div);
    });
}

function selectBand(index: number) {
    selectedIndex = index;
    updateList();
    updateControls();
    draw();
}

/**
 * PUBLIC API
 */

export function renderPEQ(container: HTMLElement, bands: Band[], updateCallback: (index: number, key: string, value: any) => void) {
    if (!container) return;

    localBands = bands;
    onUpdateCallback = updateCallback;

    if (!container.querySelector("#peq-root")) {
        container.innerHTML = `
        <div id="peq-root" class="flex flex-col md:flex-row gap-6 h-full text-white">
            <div class="flex-1 flex flex-col min-h-[300px] md:min-h-0">
                <div class="relative flex-1 bg-gray-900 border border-gray-700 rounded-lg overflow-hidden shadow-xl">
                    <canvas id="eqCanvas" class="w-full h-full cursor-crosshair"></canvas>
                </div>
            </div>

            <div class="w-full md:w-80 bg-gray-800 rounded-lg p-5 flex flex-col shadow-xl border border-gray-700 h-auto md:h-auto">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-bold">EQ Bands</h2>
                </div>

                <div id="bandList" class="space-y-2 mb-6 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                </div>

                <div id="controlsArea" class="border-t border-gray-700 pt-5 space-y-4 hidden">
                    <div class="flex justify-between items-center">
                        <h3 class="font-bold text-gray-300">Edit Band <span id="lblSelectedId">#</span></h3>
                         <label class="switch scale-75">
                            <input type="checkbox" id="inputBypass">
                            <span class="slider"></span>
                        </label>
                    </div>

                    <div>
                        <label class="block text-xs uppercase text-gray-400 mb-1">Type</label>
                        <select id="inputType" class="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:border-blue-500 outline-none">
                            <option value="PK">Peak</option>
                            <option value="LSQ">Low Shelf</option>
                            <option value="HSQ">High Shelf</option>
                        </select>
                    </div>

                    <div>
                        <div class="flex justify-between text-xs mb-1"><label>Freq</label><span id="lblFreq" class="text-blue-400">1000Hz</span></div>
                        <input id="inputFreq" type="range" class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500">
                    </div>

                    <div>
                        <div class="flex justify-between text-xs mb-1"><label>Gain</label><span id="lblGain" class="text-blue-400">0dB</span></div>
                        <input id="inputGain" type="range" step="0.5" class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500">
                    </div>

                    <div>
                        <div class="flex justify-between text-xs mb-1"><label>Q (Width)</label><span id="lblQ" class="text-blue-400">1.0</span></div>
                        <input id="inputQ" type="range" min="0.1" max="10" step="0.1" class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500">
                    </div>
                </div>
            </div>
        </div>
        `;

        canvas = container.querySelector("#eqCanvas");
        ctx = canvas?.getContext("2d") || null;
        bandList = container.querySelector("#bandList");
        controlsArea = container.querySelector("#controlsArea");

        inputs.type = container.querySelector("#inputType");
        inputs.freq = container.querySelector("#inputFreq");
        inputs.gain = container.querySelector("#inputGain");
        inputs.q = container.querySelector("#inputQ");
        inputs.bypass = container.querySelector("#inputBypass");

        labels.freq = container.querySelector("#lblFreq");
        labels.gain = container.querySelector("#lblGain");
        labels.q = container.querySelector("#lblQ");
        labels.id = container.querySelector("#lblSelectedId");

        // Use ResizeObserver for more robust layout handling (e.g. sidebar toggles)
        const resizeObserver = new ResizeObserver(() => resizeCanvas());
        if (canvas.parentElement) {
            resizeObserver.observe(canvas.parentElement);
        }

        // window.addEventListener("resize", resizeCanvas); // ResizeObserver handles this now
        resizeCanvas();

        if (canvas) {
            canvas.addEventListener("mousedown", (e) => {
                const rect = canvas!.getBoundingClientRect();
                const scaleX = ((canvas as any).logicalWidth) / rect.width;
                const scaleY = ((canvas as any).logicalHeight) / rect.height;
                const x = (e.clientX - rect.left) * scaleX;
                const y = (e.clientY - rect.top) * scaleY;

                let closestIdx = -1;
                let minDst = 1000;

                const w = (canvas as any).logicalWidth;
                const h = (canvas as any).logicalHeight;

                localBands.forEach(band => {
                    const bx = freqToX(band.freq, w);
                    const by = gainToY(band.gain, h);
                    const dist = Math.sqrt((x - bx) ** 2 + (y - by) ** 2);
                    if (dist < 20) {
                        if (dist < minDst) {
                            minDst = dist;
                            closestIdx = band.index;
                        }
                    }
                });

                if (closestIdx !== -1) {
                    draggingIndex = closestIdx;
                    selectBand(closestIdx);
                }
            });

            window.addEventListener("mousemove", (e) => {
                if (draggingIndex === null || !canvas) return;

                const rect = canvas.getBoundingClientRect();
                const relX = (e.clientX - rect.left);
                const relY = (e.clientY - rect.top);

                const clampedX = Math.max(CONFIG.padding, Math.min(rect.width - CONFIG.padding, relX));
                const clampedY = Math.max(CONFIG.padding, Math.min(rect.height - CONFIG.padding, relY));

                const freq = Math.round(xToFreq(clampedX, rect.width));
                const gain = Math.round(yToGain(clampedY, rect.height) * 10) / 10;

                handleUpdate(draggingIndex, "freq", freq);
                handleUpdate(draggingIndex, "gain", gain);
            });

            window.addEventListener("mouseup", () => {
                draggingIndex = null;
            });
        }

        inputs.type?.addEventListener("change", (e) => {
            if (selectedIndex !== null) handleUpdate(selectedIndex, "type", (e.target as HTMLSelectElement).value);
        });

        inputs.freq?.addEventListener("input", (e) => {
            if (selectedIndex !== null) {
                const val = parseFloat((e.target as HTMLInputElement).value);
                const freq = Math.round(Math.pow(10, val));
                handleUpdate(selectedIndex, "freq", freq);
            }
        });

        inputs.gain?.addEventListener("input", (e) => {
            if (selectedIndex !== null) handleUpdate(selectedIndex, "gain", (e.target as HTMLInputElement).value);
        });

        inputs.q?.addEventListener("input", (e) => {
            if (selectedIndex !== null) handleUpdate(selectedIndex, "q", (e.target as HTMLInputElement).value);
        });

        inputs.bypass?.addEventListener("change", (e) => {
            if (selectedIndex !== null) handleUpdate(selectedIndex, "enabled", (e.target as HTMLInputElement).checked);
        });
    }

    updateList();
    updateControls();
    draw();
}

function handleUpdate(index: number, key: string, value: any) {
    if (onUpdateCallback) {
        onUpdateCallback(index, key, value);
    }

    const band = localBands[index];
    if (band) {
        if (key === "freq") band.freq = Number(value);
        if (key === "gain") band.gain = Number(value);
        if (key === "q") band.q = Number(value);
        if (key === "type") band.type = String(value);
        if (key === "enabled") band.enabled = Boolean(value);

        updateList();
        updateControls();
        draw();
    }
}
