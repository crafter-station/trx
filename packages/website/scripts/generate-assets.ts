#!/usr/bin/env bun
import sharp from "sharp";
import { resolve } from "node:path";

const PUBLIC = resolve(import.meta.dir, "../public");

const BLUE = "#2563EB";
const BLUE_LIGHT = "#60A5FA";
const DARK = "#0F172A";
const WHITE = "#F8FAFC";
const GRAY = "#94A3B8";
const GRAY_DIM = "#64748B";

const ASCII_LOGO = `████████╗██████╗ ██╗  ██╗
╚══██╔══╝██╔══██╗╚██╗██╔╝
   ██║   ██████╔╝ ╚███╔╝
   ██║   ██╔══██╗ ██╔██╗
   ██║   ██║  ██║██╔╝ ██╗
   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝`;

function escapeXml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function asciiToSvgLines(ascii: string, x: number, y: number, fontSize: number, color: string): string {
	return ascii
		.split("\n")
		.map(
			(line, i) =>
				`<text x="${x}" y="${y + i * (fontSize * 1.3)}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" fill="${color}" xml:space="preserve">${escapeXml(line)}</text>`,
		)
		.join("\n");
}

const ICONS = {
	youtube:
		'<path d="M164.44,121.34l-48-32A8,8,0,0,0,104,96v64a8,8,0,0,0,12.44,6.66l48-32a8,8,0,0,0,0-13.32ZM120,145.05V111l25.58,17ZM234.33,69.52a24,24,0,0,0-14.49-16.4C185.56,39.88,131,40,128,40s-57.56-.12-91.84,13.12a24,24,0,0,0-14.49,16.4C19.08,79.5,16,97.74,16,128s3.08,48.5,5.67,58.48a24,24,0,0,0,14.49,16.41C69,215.56,120.4,216,127.34,216h1.32c6.94,0,58.37-.44,91.18-13.11a24,24,0,0,0,14.49-16.41c2.59-10,5.67-28.22,5.67-58.48S236.92,79.5,234.33,69.52Zm-15.49,113a8,8,0,0,1-4.77,5.49c-31.65,12.22-85.48,12-86,12H128c-.54,0-54.33.2-86-12a8,8,0,0,1-4.77-5.49C34.8,173.39,32,156.57,32,128s2.8-45.39,5.16-54.47A8,8,0,0,1,41.93,68c30.52-11.79,81.66-12,85.85-12h.27c.54,0,54.38-.18,86,12a8,8,0,0,1,4.77,5.49C221.2,82.61,224,99.43,224,128S221.2,173.39,218.84,182.47Z"/>',
	tiktok:
		'<path d="M224,72a48.05,48.05,0,0,1-48-48,8,8,0,0,0-8-8H128a8,8,0,0,0-8,8V156a20,20,0,1,1-28.57-18.08A8,8,0,0,0,96,130.69V88a8,8,0,0,0-9.4-7.88C50.91,86.48,24,119.1,24,156a76,76,0,0,0,152,0V116.29A103.25,103.25,0,0,0,224,128a8,8,0,0,0,8-8V80A8,8,0,0,0,224,72Zm-8,39.64a87.19,87.19,0,0,1-43.33-16.15A8,8,0,0,0,160,102v54a60,60,0,0,1-120,0c0-25.9,16.64-49.13,40-57.6v27.67A36,36,0,1,0,136,156V32h24.5A64.14,64.14,0,0,0,216,87.5Z"/>',
	instagram:
		'<path d="M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160ZM176,24H80A56.06,56.06,0,0,0,24,80v96a56.06,56.06,0,0,0,56,56h96a56.06,56.06,0,0,0,56-56V80A56.06,56.06,0,0,0,176,24Zm40,152a40,40,0,0,1-40,40H80a40,40,0,0,1-40-40V80A40,40,0,0,1,80,40h96a40,40,0,0,1,40,40ZM192,76a12,12,0,1,1-12-12A12,12,0,0,1,192,76Z"/>',
	x: '<path d="M214.75,211.71l-62.6-98.38,61.77-67.95a8,8,0,0,0-11.84-10.76L143.24,99.34,102.75,35.71A8,8,0,0,0,96,32H48a8,8,0,0,0-6.75,12.3l62.6,98.37-61.77,68a8,8,0,1,0,11.84,10.76l58.84-64.72,40.49,63.63A8,8,0,0,0,160,224h48a8,8,0,0,0,6.75-12.29ZM164.39,208,62.57,48h29L193.43,208Z"/>',
	microphone:
		'<path d="M128,176a48.05,48.05,0,0,0,48-48V64a48,48,0,0,0-96,0v64A48.05,48.05,0,0,0,128,176ZM96,64a32,32,0,0,1,64,0v64a32,32,0,0,1-64,0Zm40,143.6V240a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64,64,0,0,0,128,0,8,8,0,0,1,16,0A80.11,80.11,0,0,1,136,207.6Z"/>',
	musicNote:
		'<path d="M210.3,56.34l-80-24A8,8,0,0,0,120,40V148.26A48,48,0,1,0,136,184V98.75l69.7,20.91A8,8,0,0,0,216,112V64A8,8,0,0,0,210.3,56.34ZM88,216a32,32,0,1,1,32-32A32,32,0,0,1,88,216ZM200,101.25l-64-19.2V50.75L200,70Z"/>',
};

function icon(name: keyof typeof ICONS, x: number, y: number, size: number, color: string): string {
	const scale = size / 256;
	return `<g transform="translate(${x}, ${y}) scale(${scale})" fill="${color}">${ICONS[name]}</g>`;
}

async function generateOG(width: number, height: number, filename: string) {
	const cx = width / 2;

	const asciiY = 130;
	const taglineY = 340;
	const installY = 430;
	const iconsY = 500;

	const iconNames: (keyof typeof ICONS)[] = ["youtube", "tiktok", "instagram", "x", "microphone", "musicNote"];
	const iconSize = 28;
	const iconGap = 48;
	const totalIconsWidth = iconNames.length * iconSize + (iconNames.length - 1) * (iconGap - iconSize);
	const iconsStartX = cx - totalIconsWidth / 2;

	const iconsSvg = iconNames
		.map((name, i) => icon(name, iconsStartX + i * iconGap, iconsY, iconSize, GRAY_DIM))
		.join("\n");

	const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${DARK}"/>
      <stop offset="100%" stop-color="#1E293B"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>

  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <rect width="40" height="40" fill="none"/>
    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${BLUE}" stroke-width="0.3" opacity="0.12"/>
  </pattern>
  <rect width="${width}" height="${height}" fill="url(#grid)"/>

  <rect x="0" y="0" width="${width}" height="4" fill="${BLUE}"/>

  ${asciiToSvgLines(ASCII_LOGO, cx, asciiY, 20, BLUE_LIGHT)}

  <text x="${cx}" y="${taglineY}" text-anchor="middle" font-family="sans-serif" font-size="40" font-weight="700" fill="${WHITE}" letter-spacing="-0.5">Transcribe anything.</text>
  <text x="${cx}" y="${taglineY + 50}" text-anchor="middle" font-family="sans-serif" font-size="40" font-weight="700" fill="${BLUE_LIGHT}" letter-spacing="-0.5">Let agents fix the rest.</text>

  <rect x="${cx - 190}" y="${installY - 26}" width="380" height="38" rx="8" fill="${BLUE}" opacity="0.12"/>
  <rect x="${cx - 190}" y="${installY - 26}" width="380" height="38" rx="8" fill="none" stroke="${BLUE}" stroke-width="1" opacity="0.3"/>
  <text x="${cx - 170}" y="${installY}" font-family="monospace" font-size="15" fill="${GRAY_DIM}">$</text>
  <text x="${cx - 152}" y="${installY}" font-family="monospace" font-size="15" fill="${WHITE}">bun add -g @crafter/trx</text>

  ${iconsSvg}

  <text x="${cx}" y="${height - 40}" text-anchor="middle" font-family="monospace" font-size="12" fill="${GRAY_DIM}" letter-spacing="0.08em">Agent-first CLI  |  Local Whisper  |  99 languages  |  Open source</text>

  <rect x="0" y="${height - 4}" width="${width}" height="4" fill="${BLUE}"/>
</svg>`;

	await sharp(Buffer.from(svg)).png({ quality: 95 }).toFile(resolve(PUBLIC, filename));
	console.log(`Generated ${filename} (${width}x${height})`);
}

async function generateFavicon() {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <rect width="48" height="48" rx="8" fill="${BLUE}"/>
  <text x="24" y="20" text-anchor="middle" font-family="monospace" font-size="11" font-weight="700" fill="${WHITE}" opacity="0.5">///</text>
  <text x="24" y="34" text-anchor="middle" font-family="monospace" font-size="16" font-weight="700" fill="${WHITE}">trx</text>
</svg>`;

	await sharp(Buffer.from(svg)).resize(32, 32).png().toFile(resolve(PUBLIC, "favicon.png"));
	await Bun.write(resolve(PUBLIC, "favicon.svg"), svg);
	console.log("Generated favicon.svg + favicon.png");
}

async function main() {
	console.log("Generating brand assets...\n");
	await generateOG(1200, 630, "og.png");
	await generateOG(1200, 600, "og-twitter.png");
	await generateFavicon();
	console.log("\nDone.");
}

main();
