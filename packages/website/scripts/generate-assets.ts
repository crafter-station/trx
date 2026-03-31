#!/usr/bin/env bun
import sharp from "sharp";
import { resolve } from "node:path";

const PUBLIC = resolve(import.meta.dir, "../public");

const BLUE = "#2563EB";
const BLUE_LIGHT = "#60A5FA";
const DARK = "#0F172A";
const WHITE = "#F8FAFC";
const GRAY = "#94A3B8";

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
		.map((line, i) => `<text x="${x}" y="${y + i * (fontSize * 1.3)}" font-family="monospace" font-size="${fontSize}" fill="${color}" xml:space="preserve">${escapeXml(line)}</text>`)
		.join("\n");
}

async function generateOG(width: number, height: number, filename: string) {
	const asciiY = height === 630 ? 180 : 160;
	const taglineY = height === 630 ? 420 : 390;
	const installY = height === 630 ? 480 : 450;
	const badgeY = height === 630 ? 540 : 510;

	const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${DARK}"/>
      <stop offset="100%" stop-color="#1E293B"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>

  <!-- grid pattern -->
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <rect width="40" height="40" fill="none"/>
    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${BLUE}" stroke-width="0.3" opacity="0.15"/>
  </pattern>
  <rect width="${width}" height="${height}" fill="url(#grid)"/>

  <!-- accent line top -->
  <rect x="0" y="0" width="${width}" height="4" fill="${BLUE}"/>

  <!-- ASCII logo -->
  ${asciiToSvgLines(ASCII_LOGO, 80, asciiY, 22, BLUE_LIGHT)}

  <!-- tagline -->
  <text x="80" y="${taglineY}" font-family="sans-serif" font-size="36" font-weight="700" fill="${WHITE}">Transcribe anything.</text>
  <text x="80" y="${taglineY + 44}" font-family="sans-serif" font-size="36" font-weight="700" fill="${BLUE_LIGHT}">Let agents fix the rest.</text>

  <!-- install command -->
  <rect x="80" y="${installY - 24}" width="440" height="36" rx="6" fill="${BLUE}" opacity="0.15"/>
  <text x="96" y="${installY}" font-family="monospace" font-size="16" fill="${GRAY}">$</text>
  <text x="116" y="${installY}" font-family="monospace" font-size="16" fill="${WHITE}">bun add -g @crafter/trx</text>

  <!-- badge -->
  <text x="80" y="${badgeY}" font-family="monospace" font-size="13" fill="${GRAY}">Agent-first CLI  |  Local Whisper  |  99 languages  |  Open source</text>

  <!-- bottom accent -->
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

	const sizes = [16, 32, 48];
	const buffers = await Promise.all(
		sizes.map((size) =>
			sharp(Buffer.from(svg))
				.resize(size, size)
				.png()
				.toBuffer()
		)
	);

	await sharp(buffers[1]).toFile(resolve(PUBLIC, "favicon.png"));

	const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <rect width="48" height="48" rx="8" fill="${BLUE}"/>
  <text x="24" y="20" text-anchor="middle" font-family="monospace" font-size="11" font-weight="700" fill="${WHITE}" opacity="0.5">///</text>
  <text x="24" y="34" text-anchor="middle" font-family="monospace" font-size="16" font-weight="700" fill="${WHITE}">trx</text>
</svg>`;
	await Bun.write(resolve(PUBLIC, "favicon.svg"), faviconSvg);

	console.log("Generated favicon.svg + favicon.png");
}

async function main() {
	console.log("Generating brand assets...\n");
	await generateOG(1200, 630, "og.png");
	await generateOG(1200, 600, "og-twitter.png");
	await generateFavicon();
	console.log("\nDone. Assets in packages/website/public/");
}

main();
