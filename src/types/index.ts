export interface Note {
	id: string;
	content: string;
	created_at: number;
	updated_at: number;
	pinned: boolean;
	list: string;
	deleted: boolean;
	deleted_at: number | null;
	version_num: number;
}

export interface SharedNoteEntry extends Note {
	owner_display_name: string;
	owner_avatar_num: number | null;
	is_own: boolean;
	shared_with_names?: string[];
}

export interface UserProfile {
	display_name: string;
	avatar_num: number | null;
}

export type SortNotesBy = "date_edited" | "date_created" | "title";
export type NewNoteStart = "title" | "heading" | "subheading" | "body";

export type LoginState = "idle" | "loading" | "success" | "exiting";
export type AuthMode = "login" | "signup" | "forgot";
