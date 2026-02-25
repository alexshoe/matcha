import { AuthPage } from "@matcha/ui";
import "@matcha/ui/styles";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { useState } from "react";

// Web app entry point.
// Currently shows the auth page. Full note-editing UI will be added here once
// a web-compatible note storage adapter is implemented (localStorage / Supabase-only).
// The desktop-specific NoteEditor (which uses Tauri APIs) will be replaced with
// a web-native version that shares the @matcha/ui components but avoids @tauri-apps/*.

function App() {
	const [_user, setUser] = useState<User | null>(null);
	const [_supabaseClient, setSupabaseClient] = useState<SupabaseClient | null>(null);
	const [isAuthenticated, setIsAuthenticated] = useState(false);

	if (!isAuthenticated) {
		return (
			<AuthPage
				onLogin={(client, loggedInUser) => {
					setSupabaseClient(client);
					setUser(loggedInUser);
					setIsAuthenticated(true);
				}}
			/>
		);
	}

	return (
		<div style={{ padding: "2rem", color: "var(--text-primary, #e0e0e0)" }}>
			<h1>matcha web</h1>
			<p>Web app under construction — notes UI coming soon.</p>
		</div>
	);
}

export default App;
