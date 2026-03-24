// postBuild + postWrap hook: add local network permission to Info.plist
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const additions = `    <key>NSLocalNetworkUsageDescription</key>
    <string>ATEM Audio Router needs local network access to communicate with your ATEM switcher over UDP.</string>
    <key>NSBonjourServices</key>
    <array>
        <string>_blackmagic._tcp</string>
    </array>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsLocalNetworking</key>
        <true/>
    </dict>`;

function patchPlist(plistPath: string) {
	if (!existsSync(plistPath)) return false;
	let plist = readFileSync(plistPath, "utf-8");
	if (plist.includes("NSLocalNetworkUsageDescription")) {
		console.log(`Already patched: ${plistPath}`);
		return true;
	}
	plist = plist.replace("</dict>", additions + "\n</dict>");
	writeFileSync(plistPath, plist);
	console.log(`Patched: ${plistPath}`);
	return true;
}

// Patch the build dir .app (postBuild)
const buildDir = process.env.ELECTROBUN_BUILD_DIR;
if (buildDir) {
	const entries = readdirSync(buildDir);
	const appBundle = entries.find((e) => e.endsWith(".app"));
	if (appBundle) {
		patchPlist(join(buildDir, appBundle, "Contents", "Info.plist"));
	}
}

// Patch the wrapper bundle .app (postWrap)
const wrapperPath = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH;
if (wrapperPath) {
	patchPlist(join(wrapperPath, "Contents", "Info.plist"));
}
