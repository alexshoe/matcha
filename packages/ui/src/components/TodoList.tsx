import {
	useState,
	useEffect,
	useRef,
	useCallback,
	type DragEvent,
} from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faChevronDown,
	faChevronLeft,
	faChevronRight,
	faPlus,
	faXmark,
	faGripVertical,
	faCircleQuestion,
} from "@fortawesome/free-solid-svg-icons";
import type { SupabaseClient } from "@supabase/supabase-js";

interface TodoGoal {
	id: string;
	text: string;
	checked: boolean;
}

interface TodoTask {
	id: string;
	text: string;
	checked: boolean;
}

interface TodoListProps {
	supabaseClient: SupabaseClient | null;
	userId: string;
	autoSortChecked?: boolean;
	externalUpdate?: {
		goals: TodoGoal[];
		tasks: Record<string, TodoTask[]>;
	} | null;
}

function genId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function dateKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function getDayName(d: Date): string {
	return d.toLocaleDateString("en-US", { weekday: "long" });
}

function getRelativeLabel(d: Date, today: Date): string {
	const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
	if (diff === 0) return "Today";
	if (diff === 1) return "Tomorrow";
	if (diff === 2) return getDayName(d);
	return "";
}

function formatDateShort(d: Date): string {
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const COMPACT_BREAKPOINT = 640;

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

/** Check whether any date key in tasks is before today */
function needsRollover(
	tasks: Record<string, TodoTask[]>,
	todayKey: string,
): boolean {
	return Object.keys(tasks).some((key) => key < todayKey);
}

/** Move unchecked tasks from past days into today; discard checked + old keys */
function rolloverPastTasks(
	tasks: Record<string, TodoTask[]>,
	todayKey: string,
): Record<string, TodoTask[]> {
	const rolledOver: TodoTask[] = [];
	const cleaned: Record<string, TodoTask[]> = {};

	for (const [key, taskList] of Object.entries(tasks)) {
		if (key < todayKey) {
			for (const task of taskList) {
				if (!task.checked) rolledOver.push(task);
			}
		} else {
			cleaned[key] = taskList;
		}
	}

	if (rolledOver.length > 0) {
		cleaned[todayKey] = [...rolledOver, ...(cleaned[todayKey] || [])];
	}
	return cleaned;
}

export function TodoList({
	supabaseClient,
	userId,
	autoSortChecked = true,
	externalUpdate,
}: TodoListProps) {
	const [goals, setGoals] = useState<TodoGoal[]>(() =>
		parseJson(localStorage.getItem("matcha_todo_goals"), []),
	);
	const [tasks, setTasks] = useState<Record<string, TodoTask[]>>(() =>
		parseJson(localStorage.getItem("matcha_todo_tasks"), {}),
	);
	const [goalsExpanded, setGoalsExpanded] = useState(
		() => localStorage.getItem("matcha_todo_goalsExpanded") !== "false",
	);
	const [goalInput, setGoalInput] = useState("");
	const [taskInputs, setTaskInputs] = useState<Record<string, string>>({});
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editValue, setEditValue] = useState("");
	const editInputRef = useRef<HTMLInputElement>(null);
	const loaded = useRef(false);
	const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingToggleIds = useRef<Set<string>>(new Set());
	const goalsRef = useRef(goals);
	const tasksRef = useRef(tasks);
	goalsRef.current = goals;
	tasksRef.current = tasks;

	const syncToSupabase = useCallback(() => {
		if (!supabaseClient || !userId) return;
		if (syncTimer.current) clearTimeout(syncTimer.current);
		syncTimer.current = setTimeout(() => {
			supabaseClient
				.from("to_do_list")
				.upsert(
					{
						user_id: userId,
						long_term_goals: JSON.stringify(goalsRef.current),
						to_do_list: JSON.stringify(tasksRef.current),
					},
					{ onConflict: "user_id" },
				)
				.then(({ error }: { error: { message: string } | null }) => {
					if (error) console.warn("Todo sync error:", error.message);
				});
		}, 500);
	}, [supabaseClient, userId]);

	useEffect(() => {
		if (!supabaseClient || !userId) return;
		supabaseClient
			.from("to_do_list")
			.select("long_term_goals, to_do_list")
			.eq("user_id", userId)
			.maybeSingle()
			.then(
				({
					data,
				}: {
					data: { long_term_goals?: string; to_do_list?: string } | null;
				}) => {
					const todayStr = dateKey(new Date());
					if (data) {
						const remoteGoals = parseJson<TodoGoal[]>(data.long_term_goals, []);
						let remoteTasks = parseJson<Record<string, TodoTask[]>>(
							data.to_do_list,
							{},
						);
						if (needsRollover(remoteTasks, todayStr)) {
							remoteTasks = rolloverPastTasks(remoteTasks, todayStr);
						}
						setGoals(remoteGoals);
						setTasks(remoteTasks);
						localStorage.setItem(
							"matcha_todo_goals",
							JSON.stringify(remoteGoals),
						);
						localStorage.setItem(
							"matcha_todo_tasks",
							JSON.stringify(remoteTasks),
						);
					} else {
						// No remote data — rollover whatever was loaded from localStorage
						setTasks((prev) =>
							needsRollover(prev, todayStr)
								? rolloverPastTasks(prev, todayStr)
								: prev,
						);
					}
					loaded.current = true;
				},
			);
	}, [supabaseClient, userId]);

	const isRemoteUpdate = useRef(false);

	useEffect(() => {
		localStorage.setItem("matcha_todo_goals", JSON.stringify(goals));
		if (isRemoteUpdate.current) return;
		if (loaded.current || !supabaseClient) syncToSupabase();
	}, [goals, supabaseClient, syncToSupabase]);

	useEffect(() => {
		localStorage.setItem("matcha_todo_tasks", JSON.stringify(tasks));
		if (isRemoteUpdate.current) return;
		if (loaded.current || !supabaseClient) syncToSupabase();
	}, [tasks, supabaseClient, syncToSupabase]);

	// ── Handle realtime updates from other devices ──
	useEffect(() => {
		if (!externalUpdate) return;
		isRemoteUpdate.current = true;
		setGoals(externalUpdate.goals);
		const todayStr = dateKey(new Date());
		const cleanedTasks = needsRollover(externalUpdate.tasks, todayStr)
			? rolloverPastTasks(externalUpdate.tasks, todayStr)
			: externalUpdate.tasks;
		setTasks(cleanedTasks);
		// Reset flag after React processes the state updates
		requestAnimationFrame(() => {
			isRemoteUpdate.current = false;
		});
	}, [externalUpdate]);

	// ── Rollover for offline / no-Supabase mode ──
	useEffect(() => {
		if (supabaseClient) return; // Supabase path handles its own rollover
		const todayStr = dateKey(new Date());
		setTasks((prev) =>
			needsRollover(prev, todayStr) ? rolloverPastTasks(prev, todayStr) : prev,
		);
	}, [supabaseClient]);

	// ── Midnight rollover timer (handles app left open overnight) ──
	const midnightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		function scheduleMidnight(): ReturnType<typeof setTimeout> {
			const now = new Date();
			const tomorrow = new Date(now);
			tomorrow.setDate(tomorrow.getDate() + 1);
			tomorrow.setHours(0, 0, 0, 0);
			const ms = tomorrow.getTime() - now.getTime() + 100; // +100ms buffer

			return setTimeout(() => {
				const todayStr = dateKey(new Date());
				setTasks((prev) =>
					needsRollover(prev, todayStr)
						? rolloverPastTasks(prev, todayStr)
						: prev,
				);
				midnightTimer.current = scheduleMidnight();
			}, ms);
		}

		midnightTimer.current = scheduleMidnight();
		return () => {
			if (midnightTimer.current) clearTimeout(midnightTimer.current);
		};
	}, []);

	const [isCompact, setIsCompact] = useState(false);
	const [singleDayIdx, setSingleDayIdx] = useState(0);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			for (const entry of entries) {
				setIsCompact(entry.contentRect.width < COMPACT_BREAKPOINT);
			}
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const dragItem = useRef<{ day: string; id: string; index: number } | null>(
		null,
	);
	const dropTarget = useRef<{ day: string; index: number } | null>(null);
	const activeIndicatorEl = useRef<HTMLElement | null>(null);

	function clearIndicator() {
		if (activeIndicatorEl.current) {
			activeIndicatorEl.current.classList.remove(
				"todo-drop-before",
				"todo-drop-after",
			);
			activeIndicatorEl.current = null;
		}
		dropTarget.current = null;
	}

	function setIndicator(
		el: HTMLElement,
		position: "before" | "after",
		day: string,
		index: number,
	) {
		if (
			activeIndicatorEl.current === el &&
			el.classList.contains(`todo-drop-${position}`)
		)
			return;
		clearIndicator();
		el.classList.add(`todo-drop-${position}`);
		activeIndicatorEl.current = el;
		dropTarget.current = { day, index };
	}

	function handleDragStart(
		e: DragEvent,
		day: string,
		id: string,
		index: number,
	) {
		dragItem.current = { day, id, index };
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData("text/plain", id);
		requestAnimationFrame(() => {
			(e.target as HTMLElement)
				.closest?.(".todo-check-item")
				?.classList.add("todo-dragging");
		});
	}

	function handleDragEnd(e: DragEvent) {
		(e.currentTarget as HTMLElement).classList.remove("todo-dragging");
		clearIndicator();
		dragItem.current = null;
	}

	function handleItemDragOver(e: DragEvent, day: string, index: number) {
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = "move";
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const midY = rect.top + rect.height / 2;
		if (e.clientY < midY) {
			setIndicator(e.currentTarget as HTMLElement, "before", day, index);
		} else {
			setIndicator(e.currentTarget as HTMLElement, "after", day, index + 1);
		}
	}

	function handleContainerDragOver(
		e: DragEvent,
		day: string,
		taskCount: number,
	) {
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
		// Empty list — drop at index 0; non-empty list — drop after last item
		dropTarget.current = { day, index: taskCount };
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		const source = dragItem.current;
		const target = dropTarget.current;
		clearIndicator();
		if (!source || !target) {
			dragItem.current = null;
			return;
		}

		setTasks((prev) => {
			const next = { ...prev };
			const sourceList = [...(next[source.day] || [])];
			const taskIdx = sourceList.findIndex((t) => t.id === source.id);
			if (taskIdx === -1) return prev;

			const [moved] = sourceList.splice(taskIdx, 1);
			next[source.day] = sourceList;

			const destList =
				source.day === target.day
					? [...next[target.day]]
					: [...(next[target.day] || [])];
			const adjustedIndex =
				source.day === target.day && taskIdx < target.index
					? target.index - 1
					: target.index;
			destList.splice(Math.min(adjustedIndex, destList.length), 0, moved);
			next[target.day] = destList;

			return next;
		});

		dragItem.current = null;
	}

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const dayPlus1 = new Date(today);
	dayPlus1.setDate(dayPlus1.getDate() + 1);

	const dayPlus2 = new Date(today);
	dayPlus2.setDate(dayPlus2.getDate() + 2);

	const days = [today, dayPlus1, dayPlus2];
	const visibleDays = isCompact ? [days[singleDayIdx]] : days;

	function addGoal() {
		const text = goalInput.trim();
		if (!text) return;
		const newGoal = { id: genId(), text, checked: false };
		setGoals((prev) => {
			if (!autoSortChecked) return [...prev, newGoal];
			const firstChecked = prev.findIndex((g) => g.checked);
			if (firstChecked === -1) return [...prev, newGoal];
			return [
				...prev.slice(0, firstChecked),
				newGoal,
				...prev.slice(firstChecked),
			];
		});
		setGoalInput("");
	}

	function toggleGoal(id: string) {
		if (pendingToggleIds.current.has(id)) return;
		pendingToggleIds.current.add(id);
		setTimeout(() => pendingToggleIds.current.delete(id), 300);
		setGoals((prev) => {
			const toggled = prev.map((g) =>
				g.id === id ? { ...g, checked: !g.checked } : g,
			);
			if (!autoSortChecked) return toggled;
			return [...toggled].sort((a, b) => Number(a.checked) - Number(b.checked));
		});
	}

	function removeGoal(id: string) {
		setGoals((prev) => prev.filter((g) => g.id !== id));
	}

	function addTask(day: string) {
		const text = (taskInputs[day] || "").trim();
		if (!text) return;
		const newTask = { id: genId(), text, checked: false };
		setTasks((prev) => {
			const list = prev[day] || [];
			if (!autoSortChecked) return { ...prev, [day]: [...list, newTask] };
			const firstChecked = list.findIndex((t) => t.checked);
			return {
				...prev,
				[day]:
					firstChecked === -1
						? [...list, newTask]
						: [
								...list.slice(0, firstChecked),
								newTask,
								...list.slice(firstChecked),
							],
			};
		});
		setTaskInputs((prev) => ({ ...prev, [day]: "" }));
	}

	function toggleTask(day: string, id: string) {
		if (pendingToggleIds.current.has(id)) return;
		pendingToggleIds.current.add(id);
		setTimeout(() => pendingToggleIds.current.delete(id), 300);
		setTasks((prev) => {
			const toggled = (prev[day] || []).map((t) =>
				t.id === id ? { ...t, checked: !t.checked } : t,
			);
			return {
				...prev,
				[day]: autoSortChecked
					? [...toggled].sort((a, b) => Number(a.checked) - Number(b.checked))
					: toggled,
			};
		});
	}

	function removeTask(day: string, id: string) {
		setTasks((prev) => ({
			...prev,
			[day]: (prev[day] || []).filter((t) => t.id !== id),
		}));
	}

	function startEditing(id: string, text: string) {
		setEditingId(id);
		setEditValue(text);
		requestAnimationFrame(() => editInputRef.current?.select());
	}

	function commitGoalEdit(id: string) {
		const trimmed = editValue.trim();
		setEditingId(null);
		if (!trimmed) return;
		setGoals((prev) =>
			prev.map((g) => (g.id === id ? { ...g, text: trimmed } : g)),
		);
	}

	function commitTaskEdit(day: string, id: string) {
		const trimmed = editValue.trim();
		setEditingId(null);
		if (!trimmed) return;
		setTasks((prev) => ({
			...prev,
			[day]: (prev[day] || []).map((t) =>
				t.id === id ? { ...t, text: trimmed } : t,
			),
		}));
	}

	return (
		<div className="todo-view" ref={containerRef}>
			<div className="todo-title-row">
				<h1 className="todo-title">To-do List</h1>
				<div className="todo-info-wrap">
					<FontAwesomeIcon icon={faCircleQuestion} className="todo-info-icon" />
					<div className="todo-info-tooltip">
						Incomplete items automatically roll over to the next day.
					</div>
				</div>
			</div>

			<div className="todo-goals-card">
				<div
					className="todo-goals-header"
					role="button"
					tabIndex={0}
					onClick={() =>
						setGoalsExpanded((v) => {
							localStorage.setItem("matcha_todo_goalsExpanded", String(!v));
							return !v;
						})
					}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							setGoalsExpanded((v) => {
								localStorage.setItem("matcha_todo_goalsExpanded", String(!v));
								return !v;
							});
						}
					}}
				>
					<span className="todo-goals-label">Long-Term Goals</span>
					<FontAwesomeIcon
						icon={faChevronDown}
						className={`todo-goals-chevron${goalsExpanded ? "" : " collapsed"}`}
					/>
				</div>
				<div className={`todo-goals-body${goalsExpanded ? " expanded" : ""}`}>
					<div className="todo-goals-collapse-wrapper">
						<div className="todo-goals-inner">
							{goals.map((goal) => (
								<div
									key={goal.id}
									className={`todo-check-item${goal.checked ? " checked" : ""}`}
								>
									<label className="todo-check-toggle">
										<input
											type="checkbox"
											checked={goal.checked}
											onChange={() => toggleGoal(goal.id)}
										/>
										<span className="todo-check-circle" />
									</label>
									{editingId === goal.id ? (
										<input
											ref={editInputRef}
											className="todo-edit-input"
											value={editValue}
											onChange={(e) => setEditValue(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter") commitGoalEdit(goal.id);
												else if (e.key === "Escape") setEditingId(null);
											}}
											onBlur={() => commitGoalEdit(goal.id)}
										/>
									) : (
										<span
											className="todo-check-text"
											role="textbox"
											tabIndex={0}
											onClick={() => startEditing(goal.id, goal.text)}
											onKeyDown={(e) => {
												if (e.key === "Enter") startEditing(goal.id, goal.text);
											}}
										>
											{goal.text}
										</span>
									)}
									<button
										type="button"
										className="todo-remove-btn"
										onClick={() => removeGoal(goal.id)}
										aria-label="Remove goal"
									>
										<FontAwesomeIcon icon={faXmark} />
									</button>
								</div>
							))}
						</div>
						<div className="todo-add-row">
							<input
								className="todo-add-input"
								placeholder="Add a long-term goal..."
								value={goalInput}
								onChange={(e) => setGoalInput(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") addGoal();
								}}
							/>
							<button
								type="button"
								className="todo-add-btn"
								onClick={addGoal}
								disabled={!goalInput.trim()}
							>
								<FontAwesomeIcon icon={faPlus} />
							</button>
						</div>
					</div>
				</div>
			</div>

			{isCompact && (
				<div className="todo-day-nav">
					<button
						type="button"
						className="todo-day-nav-btn"
						onClick={() => setSingleDayIdx((i) => Math.max(0, i - 1))}
						disabled={singleDayIdx === 0}
						aria-label="Previous day"
					>
						<FontAwesomeIcon icon={faChevronLeft} />
					</button>
					<span className="todo-day-nav-label">
						{getRelativeLabel(days[singleDayIdx], today)}
						<span className="todo-day-nav-date">
							{formatDateShort(days[singleDayIdx])}
						</span>
					</span>
					<button
						type="button"
						className="todo-day-nav-btn"
						onClick={() => setSingleDayIdx((i) => Math.min(2, i + 1))}
						disabled={singleDayIdx === 2}
						aria-label="Next day"
					>
						<FontAwesomeIcon icon={faChevronRight} />
					</button>
				</div>
			)}

			<div className={`todo-days-section${isCompact ? " compact" : ""}`}>
				{visibleDays.map((d) => {
					const key = dateKey(d);
					const dayTasks = tasks[key] || [];
					const completed = dayTasks.filter((t) => t.checked).length;
					const total = dayTasks.length;
					const isToday = key === dateKey(today);
					const relLabel = getRelativeLabel(d, today);
					const inputVal = taskInputs[key] || "";

					return (
						<div
							key={key}
							className={`todo-day-card${isToday ? " today" : ""}`}
						>
							{!isCompact && (
								<div className="todo-day-header">
									<div className="todo-day-info">
										<span className={`todo-day-name${isToday ? " today" : ""}`}>
											{getDayName(d)}
										</span>
										<span className="todo-day-relative">{relLabel}</span>
									</div>
									<span className="todo-day-count">
										{completed} / {total}
									</span>
								</div>
							)}
							{isCompact && (
								<div className="todo-day-header">
									<span className="todo-day-count">
										{completed} / {total} completed
									</span>
								</div>
							)}
							<div
								className="todo-day-tasks"
								onDragOver={(e) =>
									handleContainerDragOver(e, key, dayTasks.length)
								}
								onDragLeave={(e) => {
									// Only clear when leaving the container entirely, not entering a child
									if (!e.currentTarget.contains(e.relatedTarget as Node)) {
										clearIndicator();
									}
								}}
								onDrop={handleDrop}
							>
								{dayTasks.length > 0 && (
									<div
										className="todo-drop-sentinel"
										onDragOver={(e) => {
											e.preventDefault();
											e.stopPropagation();
											e.dataTransfer.dropEffect = "move";
											const firstItem = e.currentTarget
												.nextElementSibling as HTMLElement | null;
											if (firstItem) setIndicator(firstItem, "before", key, 0);
										}}
										onDrop={handleDrop}
									/>
								)}
								{dayTasks.map((task, taskIdx) => (
									<div
										key={task.id}
										className={`todo-check-item${task.checked ? " checked" : ""}`}
										draggable
										onDragStart={(e) =>
											handleDragStart(e, key, task.id, taskIdx)
										}
										onDragEnd={handleDragEnd}
										onDragOver={(e) => handleItemDragOver(e, key, taskIdx)}
										onDrop={handleDrop}
									>
										<span className="todo-drag-handle" aria-hidden="true">
											<FontAwesomeIcon icon={faGripVertical} />
										</span>
										<label className="todo-check-toggle">
											<input
												type="checkbox"
												checked={task.checked}
												onChange={() => toggleTask(key, task.id)}
											/>
											<span className="todo-check-circle" />
										</label>
										{editingId === task.id ? (
											<input
												ref={editInputRef}
												className="todo-edit-input"
												value={editValue}
												onChange={(e) => setEditValue(e.target.value)}
												onKeyDown={(e) => {
													if (e.key === "Enter") commitTaskEdit(key, task.id);
													else if (e.key === "Escape") setEditingId(null);
												}}
												onBlur={() => commitTaskEdit(key, task.id)}
											/>
										) : (
											<span
												className="todo-check-text"
												role="textbox"
												tabIndex={0}
												onClick={() => startEditing(task.id, task.text)}
												onKeyDown={(e) => {
													if (e.key === "Enter")
														startEditing(task.id, task.text);
												}}
											>
												{task.text}
											</span>
										)}
										<button
											type="button"
											className="todo-remove-btn"
											onClick={() => removeTask(key, task.id)}
											aria-label="Remove task"
										>
											<FontAwesomeIcon icon={faXmark} />
										</button>
									</div>
								))}
							</div>
							<div className="todo-add-row">
								<input
									className="todo-add-input"
									placeholder="Add task..."
									value={inputVal}
									onChange={(e) =>
										setTaskInputs((prev) => ({
											...prev,
											[key]: e.target.value,
										}))
									}
									onKeyDown={(e) => {
										if (e.key === "Enter") addTask(key);
									}}
								/>
								<button
									type="button"
									className="todo-add-btn"
									onClick={() => addTask(key)}
									disabled={!inputVal.trim()}
								>
									<FontAwesomeIcon icon={faPlus} />
								</button>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
