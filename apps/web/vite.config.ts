import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react()],

	// Load .env files from monorepo root (shared with apps/desktop)
	envDir: "../../",

	server: {
		port: 3000,
		allowedHosts: true, // allow ngrok and other tunnel hosts
	},
});
