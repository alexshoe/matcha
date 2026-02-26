import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react()],

	// Load .env files from monorepo root (shared with apps/desktop)
	envDir: "../../",

	server: {
		host: true, // bind to 0.0.0.0 so ngrok can reach it
		port: 3000,
		allowedHosts: true,
	},
});
