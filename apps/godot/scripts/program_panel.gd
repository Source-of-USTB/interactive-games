extends Control

const Ui = preload("res://scripts/theme.gd")

var state: Dictionary = {}
var active_line := -1
var ui := Ui.new()

func set_state(next_state: Dictionary) -> void:
	state = next_state
	queue_redraw()

func set_active_line(line: int) -> void:
	if active_line == line:
		return
	active_line = line
	queue_redraw()

func _draw() -> void:
	_draw_text("共享程序", Vector2(26, 37), 23, Ui.INK)
	_draw_text("PROGRAM", Vector2(size.x - 123, 36), 14, Ui.MUTED)
	if state.is_empty():
		_draw_text("正在等待城市任务…", Vector2(26, 111), 22, Ui.MUTED)
		return
	var slots: Array = state.get("slots", [])
	var locked: Dictionary = state.get("lockedChoices", {})
	var locked_count := 0
	for raw_slot in slots:
		if locked.has(str(raw_slot.get("slotId", ""))): locked_count += 1
	_draw_text("%s / %s 条指令已写入" % [locked_count, slots.size()], Vector2(26, 65), 15, Ui.MUTED)
	draw_line(Vector2(26, 80), Vector2(size.x - 26, 80), Color(Ui.ACCENT, 0.12), 1.0)
	if slots.is_empty():
		_draw_text("此关无需填写参数", Vector2(26, 125), 22, Ui.MUTED)
		return
	var line_height := minf(58.0, (size.y - 140.0) / float(slots.size()))
	var font_size := 20 if line_height >= 35 else 17
	var row_index := 0
	for raw_slot in slots:
		var slot: Dictionary = raw_slot
		var line := int(slot.get("line", 0))
		var slot_id := str(slot.get("slotId", ""))
		var selected = locked.get(slot_id, null)
		var executing := str(state.get("phase", "")) == "EXECUTE"
		var is_current := line == active_line if executing else row_index == int(state.get("currentSlotIndex", -1)) and str(state.get("phase", "")) == "AUTHORING"
		var row_rect := Rect2(18, 91 + row_index * line_height, size.x - 36, line_height - 4)
		var y := row_rect.get_center().y + float(font_size) * 0.36
		if is_current:
			draw_style_box(ui.surface(Color(Ui.ACCENT, 0.08), 8, Color(Ui.ACCENT, 0.24)), row_rect)
			draw_rect(Rect2(row_rect.position + Vector2(0, 7), Vector2(3, row_rect.size.y - 14)), Ui.ACCENT, true)
		elif row_index % 2 == 0:
			draw_style_box(ui.surface(Color(Ui.ACCENT, 0.018), 8, Color.TRANSPARENT), row_rect)
		_draw_text(str(line).pad_zeros(2), Vector2(33, y), font_size - 2, Ui.ACCENT if is_current else Ui.MUTED)
		var prompt := str(slot.get("prompt", "选择指令"))
		_draw_text(_fit_text(prompt, size.x - 274, font_size), Vector2(80, y), font_size, Ui.INK if selected != null or is_current else Ui.MUTED)
		var value_label := "等待投票"
		var value_color := Ui.YELLOW
		if selected != null:
			value_label = _value_label(selected)
			value_color = Ui.GREEN
		elif int(state.get("currentSlotIndex", -1)) < row_index:
			value_label = "待编写"
			value_color = Ui.MUTED
		var value_rect := Rect2(size.x - 177, row_rect.position.y + 4, 143, row_rect.size.y - 8)
		draw_style_box(ui.surface(Color(value_color, 0.065), 6, Color.TRANSPARENT), value_rect)
		var value_width := ThemeDB.fallback_font.get_string_size(value_label, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size - 1).x
		_draw_text(value_label, Vector2(value_rect.get_center().x - value_width * 0.5, y), font_size - 1, value_color)
		row_index += 1
	var track := Rect2(26, size.y - 38, size.x - 52, 3)
	draw_rect(track, Color(Ui.ACCENT, 0.09), true)
	draw_rect(Rect2(track.position, Vector2(track.size.x * float(locked_count) / float(slots.size()), 3)), Ui.ACCENT, true)
	_draw_text("执行中 · 高亮行对应小码当前动作" if str(state.get("phase", "")) == "EXECUTE" else "每一次选择，都将成为城市的下一步。", Vector2(26, size.y - 13), 14, Ui.MUTED)

func _value_label(value) -> String:
	if value is float or value is int:
		return "循环 ×" + str(int(value))
	return {"MOVE": "↑  前进", "TURN_LEFT": "←  左转", "TURN_RIGHT": "→  右转"}.get(str(value), str(value))

func _fit_text(text: String, width: float, font_size: int) -> String:
	var font := ThemeDB.fallback_font
	if font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x <= width:
		return text
	while text.length() > 0 and font.get_string_size(text + "…", HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x > width:
		text = text.left(text.length() - 1)
	return text + "…"

func _draw_text(text: String, position: Vector2, font_size: int, color: Color) -> void:
	draw_string(ThemeDB.fallback_font, position, text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, color)
