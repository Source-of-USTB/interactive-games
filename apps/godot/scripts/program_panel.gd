extends Control

var state: Dictionary = {}
var active_line := -1

const CODE_BG := Color("0d1530")
const MUTED := Color("8da2cf")
const ACCENT := Color("5ae4ff")
const PURPLE := Color("a98cff")
const GREEN := Color("45e6a1")

func set_state(next_state: Dictionary) -> void:
	state = next_state
	queue_redraw()

func set_active_line(line: int) -> void:
	if active_line == line:
		return
	active_line = line
	queue_redraw()

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), CODE_BG, true)
	if state.is_empty():
		return
	var slots: Array = state.get("slots", [])
	var locked: Dictionary = state.get("lockedChoices", {})
	var y := 36.0
	_draw_text("共享程序  /  PROGRAM", Vector2(28, y), 20, MUTED)
	y += 40.0
	if slots.is_empty():
		_draw_text("此关无需填写参数", Vector2(28, y), 24, MUTED)
		return
	var line_height := minf(66.0, maxf(34.0, (size.y - 76.0) / float(slots.size())))
	for raw_slot in slots:
		var slot: Dictionary = raw_slot
		var line := int(slot.get("line", 0))
		var slot_id := str(slot.get("slotId", ""))
		var selected = locked.get(slot_id, null)
		var is_current := line == active_line
		var row_rect := Rect2(18, y - line_height * 0.5, size.x - 36, line_height)
		if is_current:
			draw_rect(row_rect, Color(ACCENT, 0.12), true)
			draw_rect(Rect2(row_rect.position, Vector2(5, row_rect.size.y)), ACCENT, true)
		_draw_text(str(line).pad_zeros(2), Vector2(30, y + 7), 19, MUTED)
		var prompt := str(slot.get("prompt", "选择指令"))
		_draw_text(prompt, Vector2(72, y + 7), 22, Color.WHITE)
		var value_label := "等待投票"
		var value_color := PURPLE
		if selected != null:
			value_label = _value_label(selected)
			value_color = GREEN
		elif int(state.get("currentSlotIndex", -1)) < slots.find(raw_slot):
			value_label = "待编写"
			value_color = MUTED
		var width := ThemeDB.fallback_font.get_string_size(value_label, HORIZONTAL_ALIGNMENT_LEFT, -1, 21).x
		_draw_text(value_label, Vector2(size.x - width - 30, y + 7), 21, value_color)
		y += line_height

func _value_label(value) -> String:
	if value is float or value is int:
		return "循环 ×" + str(int(value))
	return {"MOVE": "↑  前进", "TURN_LEFT": "↶  左转", "TURN_RIGHT": "↷  右转"}.get(str(value), str(value))

func _draw_text(text: String, position: Vector2, font_size: int, color: Color) -> void:
	draw_string(ThemeDB.fallback_font, position, text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, color)
