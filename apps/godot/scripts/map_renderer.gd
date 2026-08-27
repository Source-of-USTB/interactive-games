extends Control

const Ui = preload("res://scripts/theme.gd")

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
var _last_redraw_ms := 0
var ui := Ui.new()

func _process(_delta: float) -> void:
	var now := Time.get_ticks_msec()
	if now - _last_redraw_ms >= 100:
		_last_redraw_ms = now
		queue_redraw()

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
	if state.is_empty():
		ui.draw_background(self)
		ui.draw_centered(self, "正在读取城市地图…", size * 0.5, 28, Color("9baed8"))
		return
	var map: Dictionary = state.get("map", {})
	var width := int(map.get("width", 8))
	var height := int(map.get("height", 6))
	var available := size - Vector2(72, 72)
	var cell := minf(available.x / float(width), available.y / float(height))
	var board_size := Vector2(cell * width, cell * height)
	var origin := (size - board_size) * 0.5
	ui.draw_map_background(self, cell, origin, width, height)
	var goal: Dictionary = map.get("goal", {})
	var goal_center := _cell_center(origin, cell, int(goal.get("x", 0)), int(goal.get("y", 0)))
	ui.draw_goal(self, goal_center, cell)
	for raw_tile in map.get("tiles", []):
		var tile: Dictionary = raw_tile
		ui.draw_tile(self, tile, _cell_center(origin, cell, int(tile.get("x", 0)), int(tile.get("y", 0))), cell, active_switches, collected_chips)
	ui.draw_robot(self, origin + (robot_position + Vector2(0.5, 0.5)) * cell, cell, robot_direction)

func _cell_center(origin: Vector2, cell: float, x: int, y: int) -> Vector2:
	return origin + Vector2(x + 0.5, y + 0.5) * cell
