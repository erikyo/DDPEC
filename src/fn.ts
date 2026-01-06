import {
	DEFAULT_FREQS,
	VID_COMTRUE,
	VID_FIIO,
	VID_SAVITECH,
	VID_SAVITECH_OFFICIAL,
} from "./constants.ts";
import { readDeviceParams, setupListener, syncToDevice } from "./dsp.ts";
import { enableControls, log, updateGlobalGainUI } from "./helpers.ts";
import type { Band, EQ } from "./main.ts";
import { renderPEQ, resizeCanvas } from "./peq.ts";

/**
 * STATE
 */
let device: HIDDevice | null = null;
let globalGainState: number = 0;
let eqState: EQ = defaultEqState();

/**
 * INITIALIZATION
 */
export function initState() {
	renderUI(eqState);

	resizeCanvas();
}

// Questa funzione ora aggiorna sia lo stato che la UI
export function setGlobalGain(gain: number) {
	globalGainState = gain;
	updateGlobalGainUI(gain);
}

export function getDevice() {
	return device;
}

export function getEqState() {
	return eqState;
}

export function setEqState(eq: EQ) {
	eqState = eq;
}

export function setEQ(
	index: number,
	key: keyof Band,
	value: number | boolean | string,
) {
	// @ts-expect-error - Dynamic key assignment
	eqState[index][key] = value;
}

export function getGlobalGainState() {
	return globalGainState;
}

export function setGlobalGainState(gainState: number) {
	globalGainState = gainState;
}

/**
 * DEFAULT EQ STATE
 */
export function defaultEqState(): EQ {
	return DEFAULT_FREQS.map((freq, i) => ({
		index: i,
		freq: freq,
		gain: 0,
		q: 0.75, // Default Q
		type: "PK",
		enabled: true,
	})) as EQ;
}
/**
 * Render UI
 */
export function renderUI(eqState: EQ) {
	const container: HTMLElement | null = document.getElementById("eqContainer");
	if (!container) {
		console.error("EQ Container not found!");
		return;
	}

	// Delegate to the visualizer
	renderPEQ(container, eqState, (index, key, value) => {
		updateState(index, key, value);
	});
}

/**
 * Connect to device
 */
export async function connectToDevice() {
	try {
		const devices = await navigator.hid.requestDevice({
			filters: [
				{ vendorId: VID_SAVITECH }, // JCally
				{ vendorId: VID_SAVITECH_OFFICIAL }, // Fosi, iBasso
				{ vendorId: VID_COMTRUE }, // Moondrop, Tanchjim
				{ vendorId: VID_FIIO }, // FiiO
			],
		});
		if (devices.length === 0) return;

		device = devices[0];
		await device.open();

		log(
			`Connected to: ${device.productName} (VID: 0x${device.vendorId.toString(16).toUpperCase()})`,
		);

		// Setup UI state
		const statusBadge = document.getElementById("statusBadge");
		if (statusBadge) {
			statusBadge.innerText = "ONLINE";
			statusBadge.classList.add("connected");
		}
		const btnConnect = document.getElementById("btnConnect");
		if (btnConnect) btnConnect.style.display = "none";

		enableControls(true);

		// For Savitech we can read. For others, we might start with a blank slate or implement reading later.
		if (
			device.vendorId === VID_SAVITECH ||
			device.vendorId === VID_SAVITECH_OFFICIAL
		) {
			setupListener(device);
			await readDeviceParams(device);
		}
	} catch (err) {
		log(`Error: ${(err as Error).message}`);
	}
}

/**
 * Reset to factory defaults
 */
export async function resetToDefaults() {
	if (
		!confirm(
			"Reset all bands to Defaults (0dB, Q=0.75) and optimal frequencies?",
		)
	)
		return;

	log("Resetting to factory defaults...");

	eqState = defaultEqState();

	// Reset Global Gain State
	setGlobalGain(0);

	// Re-render UI
	renderUI(eqState);

	// Auto-sync to device using the updated state
	await syncToDevice();
	log("Defaults applied and synced.");
}

/**
 * STATE & UI UPDATES
 */

/**
 * Update state object
 * @param {number} index - Band index
 * @param {string} key - Property to update
 * @param {number} value - New value
 */
export function updateState(
	index: number,
	key: string,
	value: string | number | boolean,
) {
	if (key === "freq" || key === "gain" || key === "q")
		value = parseFloat(value as string);
	else if (key === "enabled") value = Boolean(value);

	setEQ(index, key as keyof Band, value);

	// Refresh UI to keep consistency
	renderUI(eqState);
}

// Expose functions to global window object for inline event handlers
(window as any).updateState = updateState;
