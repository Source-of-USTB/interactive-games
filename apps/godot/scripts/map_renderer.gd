extends Control

var state: Dictionary = {}
var robot_position := Vector2.ZERO
var robot_direction := "E"
var active_switches: Array = []
var collected_chips: Array = []
var current_line := -1
var phase_time_ms := 0.0
var execution_finished := false
var current_sequence := -1
var max_displayed_sequence := -1
var current_event_type := ""

const COLOR_BG := Color("101836")
const COLOR_GRID := Color("2a3a69")
const COLOR_FLOOR := Color("17254d")
const COLOR_ACCENT := Color("5ae4ff")
const COLOR_PURPLE := Color("9673ff")
const COLOR_GREEN := Color("45e6a1")
const COLOR_YELLOW := Color("ffd66b")
const COLOR_RED := Color("ff6f91")

func set_state(next_state: Dictionary) -> void:
	state = next_state
	var map: Dictionary = state.get("map", {})
	var start: Dictionary = map.get("start", {})
	robot_position = Vector2(float(start.get("x", 0)), float(start.get("y", 0)))
	robot_direction = str(start.get("direction", "E"))
	active_switches = start.get("activeSwitches", []).duplicate()
	collected_chips = start.get("collectedChips", []).duplicate()
	queue_redraw()

func playback_at(corrected_now_ms: float) -> void:
	if state.is_empty():
		return
	var phase := str(state.get("phase", "ATTRACT"))
	var executable := phase in ["EXECUTE", "REEXECUTE", "RESULT"]
	if not executable:
		return
	phase_time_ms = maxf(0.0, corrected_now_ms - float(state.get("phaseStartedAt", corrected_now_ms)))
	var teaching_replay: bool = phase == "RESULT" and not bool(state.get("score", {}).get("missionStar", false)) and phase_time_ms >= 2000 and not state.get("solutionTrace", []).is_empty()
	var trace: Array = state.get("solutionTrace", []) if teaching_replay else state.get("trace", [])
	if teaching_replay:
		phase_time_ms -= 2000.0
		var solution_duration := 0.0
		for raw_solution_event in trace: solution_duration += float(raw_solution_event.get("durationMs", 400))
		phase_time_ms *= maxf(1.0, solution_duration / 6000.0)
	var elapsed := 0.0
	current_line = -1
	current_sequence = -1
	current_event_type = ""
	max_displayed_sequence = -1
	execution_finished = true
	for raw_event in trace:
		var event: Dictionary = raw_event
		var duration := float(event.get("durationMs", 400))
		if phase_time_ms < elapsed + duration:
			execution_finished = false
			current_line = int(event.get("sourceLine", -1))
			current_sequence = int(event.get("sequence", -1))
			current_event_type = str(event.get("type", ""))
			var before: Dictionary = event.get("before", {})
			var after: Dictionary = event.get("after", before)
			var progress := clampf((phase_time_ms - elapsed) / maxf(duration, 1.0), 0.0, 1.0)
			var from_position := Vector2(float(before.get("x", 0)), float(before.get("y", 0)))
			var to_position := Vector2(float(after.get("x", 0)), float(after.get("y", 0)))
			robot_position = from_position.lerp(to_position, _ease(progress))
			robot_direction = str(after.get("direction", before.get("direction", "E"))) if progress > 0.5 else str(before.get("direction", "E"))
			active_switches = after.get("activeSwitches", []).duplicate() if progress > 0.65 else before.get("activeSwitches", []).duplicate()
			collected_chips = after.get("collectedChips", []).duplicate() if progress > 0.65 else before.get("collectedChips", []).duplicate()
			break
		elapsed += duration
		max_displayed_sequence = int(event.get("sequence", max_displayed_sequence))
		var after_done: Dictionary = event.get("after", {})
		robot_position = Vector2(float(after_done.get("x", robot_position.x)), float(after_done.get("y", robot_position.y)))
		robot_direction = str(after_done.get("direction", robot_direction))
		active_switches = after_done.get("activeSwitches", []).duplicate()
		collected_chips = after_done.get("collectedChips", []).duplicate()
	queue_redraw()

func _ease(value: float) -> float:
	return value * value * (3.0 - 2.0 * value)

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), COLOR_BG, true)
	if state.is_empty():
		_draw_centered("正在读取城市地图…", size * 0.5, 28, Color("9baed8"))
		return
	var map: Dictionary = state.get("map", {})
	var width := int(map.get("width", 8))
	var height := int(map.get("height", 6))
	var available := size - Vector2(72, 72)
	var cell := minf(available.x / float(width), available.y / float(height))
	var board_size := Vector2(cell * width, cell * height)
	var origin := (size - board_size) * 0.5
	for y in range(height):
		for x in range(width):
			var rect := Rect2(origin + Vector2(x, y) * cell + Vector2(3, 3), Vector2(cell - 6, cell - 6))
			draw_rect(rect, COLOR_FLOOR, true)
			draw_rect(rect, COLOR_GRID, false, 2.0)
	var goal: Dictionary = map.get("goal", {})
	var goal_center := _cell_center(origin, cell, int(goal.get("x", 0)), int(goal.get("y", 0)))
	draw_circle(goal_center, cell * 0.31, Color(COLOR_GREEN, 0.20))
	draw_arc(goal_center, cell * 0.30, 0, TAU, 32, COLOR_GREEN, 5.0)
	_draw_centered("◆", goal_center + Vector2(0, cell * 0.09), int(cell * 0.34), COLOR_GREEN)
	for raw_tile in map.get("tiles", []):
		_draw_tile(raw_tile, origin, cell)
	_draw_robot(origin, cell)

func _draw_tile(tile: Dictionary, origin: Vector2, cell: float) -> void:
	var x := int(tile.get("x", 0))
	var y := int(tile.get("y", 0))
	var center := _cell_center(origin, cell, x, y)
	var kind := str(tile.get("kind", ""))
	match kind:
		"WALL":
			var rect := Rect2(center - Vector2.ONE * cell * 0.36, Vector2.ONE * cell * 0.72)
			draw_rect(rect, Color("34436f"), true)
			draw_rect(rect, Color("6579ad"), false, 3.0)
			for offset in [-0.19, 0.0, 0.19]:
				draw_line(center + Vector2(-cell * 0.31, cell * offset), center + Vector2(cell * 0.31, cell * offset), Color("526694"), 2.0)
		"CHIP":
			if not str(tile.get("id", "")) in collected_chips:
				draw_circle(center, cell * 0.18, COLOR_YELLOW)
				draw_arc(center, cell * 0.24, 0, TAU, 24, Color(COLOR_YELLOW, 0.35), 5.0)
				_draw_centered("+", center + Vector2(0, cell * 0.08), int(cell * 0.28), COLOR_BG)
		"SWITCH":
			var active := str(tile.get("id", "")) in active_switches
			draw_circle(center, cell * 0.24, COLOR_GREEN if active else COLOR_PURPLE)
			_draw_centered("●", center + Vector2(0, cell * 0.07), int(cell * 0.28), Color.WHITE)
		"DOOR":
			var open := str(tile.get("switchId", "")) in active_switches
			var door_color := Color(COLOR_GREEN, 0.32) if open else COLOR_RED
			draw_rect(Rect2(center - Vector2(cell * 0.32, cell * 0.1), Vector2(cell * 0.64, cell * 0.2)), door_color, true)
			if not open:
				draw_line(center + Vector2(-cell * 0.25, -cell * 0.25), center + Vector2(cell * 0.25, cell * 0.25), COLOR_RED, 5.0)
		"CONVEYOR":
			_draw_centered(_direction_glyph(str(tile.get("direction", "E"))), center + Vector2(0, cell * 0.1), int(cell * 0.42), COLOR_ACCENT)
		"DIRECTION":
			_draw_centered(_direction_glyph(str(tile.get("direction", "E"))), center + Vector2(0, cell * 0.1), int(cell * 0.42), COLOR_PURPLE)
		"COLOR":
			var color := Color("438dff") if tile.get("color", "BLUE") == "BLUE" else COLOR_YELLOW
			draw_circle(center, cell * 0.22, Color(color, 0.6))

func _draw_robot(origin: Vector2, cell: float) -> void:
	var center := origin + (robot_position + Vector2(0.5, 0.5)) * cell
	draw_circle(center, cell * 0.31, Color(COLOR_ACCENT, 0.18))
	draw_circle(center, cell * 0.24, COLOR_ACCENT)
	draw_circle(center, cell * 0.18, Color("17254d"))
	_draw_centered(_direction_glyph(robot_direction), center + Vector2(0, cell * 0.105), int(cell * 0.42), Color.WHITE)

func _cell_center(origin: Vector2, cell: float, x: int, y: int) -> Vector2:
	return origin + Vector2(x + 0.5, y + 0.5) * cell

func _direction_glyph(direction: String) -> String:
	return {"N": "↑", "E": "→", "S": "↓", "W": "←"}.get(direction, "→")

func _draw_centered(text: String, center: Vector2, font_size: int, color: Color) -> void:
	var font := ThemeDB.fallback_font
	var text_size := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size)
	draw_string(font, center - Vector2(text_size.x * 0.5, -text_size.y * 0.30), text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, color)
