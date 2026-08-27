extends RefCounted

const BG := Color("070c1d")
const ACCENT := Color("5ae4ff")
const PURPLE := Color("a98cff")
const GREEN := Color("45e6a1")
const YELLOW := Color("ffd66b")
const MUTED := Color("92a5cf")
const PANEL := Color("0e1733")
const CARD_BG := Color("111b3b")
const DANGER := Color("ff718e")

const MAP_BG := Color("101836")
const MAP_GRID := Color("2a3a69")
const MAP_FLOOR := Color("17254d")
const MAP_PURPLE := Color("9673ff")
const MAP_RED := Color("ff6f91")
const BLUE := Color("2f6bff")

func label(text: String, font_size: int, color: Color) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	return label

func pill(text: String, color: Color) -> Label:
	var label := label(text, 20, color)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	var style := StyleBoxFlat.new()
	style.bg_color = Color(color, 0.10)
	style.border_color = Color(color, 0.35)
	style.set_border_width_all(1)
	style.set_corner_radius_all(20)
	label.add_theme_stylebox_override("normal", style)
	return label

func panel(color: Color, radius: int) -> Panel:
	var panel := Panel.new()
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.border_color = Color(ACCENT, 0.13)
	style.set_border_width_all(1)
	style.set_corner_radius_all(radius)
	panel.add_theme_stylebox_override("panel", style)
	return panel

func draw_background(canvas: CanvasItem) -> void:
	canvas.draw_rect(Rect2(Vector2.ZERO, canvas.size), BG, true)
	for index in range(12):
		var x := fmod(float(index * 227 + 83), canvas.size.x)
		var y := fmod(float(index * 131 + 47), canvas.size.y)
		canvas.draw_circle(Vector2(x, y), 2.0 + float(index % 3), Color(ACCENT, 0.16))
	for x in range(0, int(canvas.size.x), 80):
		canvas.draw_line(Vector2(x, 0), Vector2(x, canvas.size.y), Color(ACCENT, 0.025), 1.0)
	for y in range(0, int(canvas.size.y), 80):
		canvas.draw_line(Vector2(0, y), Vector2(canvas.size.x, y), Color(PURPLE, 0.025), 1.0)

func draw_map_background(canvas: CanvasItem, cell: float, origin: Vector2, width: int, height: int) -> void:
	canvas.draw_rect(Rect2(Vector2.ZERO, canvas.size), MAP_BG, true)
	for y in range(height):
		for x in range(width):
			var rect := Rect2(origin + Vector2(x, y) * cell + Vector2(3, 3), Vector2(cell - 6, cell - 6))
			canvas.draw_rect(rect, MAP_FLOOR, true)
			canvas.draw_rect(rect, MAP_GRID, false, 2.0)

func draw_goal(canvas: CanvasItem, center: Vector2, cell: float) -> void:
	var pole_bottom := center + Vector2(0, cell * 0.30)
	var pole_top := center + Vector2(0, -cell * 0.24)
	canvas.draw_line(pole_bottom, pole_top, Color("d8e8ff"), 3.0)
	canvas.draw_colored_polygon(PackedVector2Array([
		pole_top,
		center + Vector2(cell * 0.27, -cell * 0.06),
		center + Vector2(0, -cell * 0.06),
	]), GREEN)

func draw_tile(canvas: CanvasItem, tile: Dictionary, center: Vector2, cell: float, active_switches: Array, collected_chips: Array) -> void:
	var kind := str(tile.get("kind", ""))
	match kind:
		"WALL":
			var rect := Rect2(center - Vector2.ONE * cell * 0.5, Vector2.ONE * cell)
			canvas.draw_rect(rect, MAP_BG, true)
		"CHIP":
			if not str(tile.get("id", "")) in collected_chips:
				canvas.draw_circle(center, cell * 0.18, YELLOW)
				canvas.draw_arc(center, cell * 0.24, 0, TAU, 24, Color(YELLOW, 0.35), 5.0)
				draw_centered(canvas, "+", center + Vector2(0, cell * 0.08), int(cell * 0.28), BG)
		"SWITCH":
			var active := str(tile.get("id", "")) in active_switches
			canvas.draw_circle(center, cell * 0.24, GREEN if active else MAP_PURPLE)
			draw_centered(canvas, "●", center + Vector2(0, cell * 0.07), int(cell * 0.28), Color.WHITE)
		"DOOR":
			var open := str(tile.get("switchId", "")) in active_switches
			var door_color := Color(GREEN, 0.32) if open else MAP_RED
			canvas.draw_rect(Rect2(center - Vector2(cell * 0.32, cell * 0.1), Vector2(cell * 0.64, cell * 0.2)), door_color, true)
			if not open:
				canvas.draw_line(center + Vector2(-cell * 0.25, -cell * 0.25), center + Vector2(cell * 0.25, cell * 0.25), MAP_RED, 5.0)
		"CONVEYOR":
			draw_centered(canvas, direction_glyph(str(tile.get("direction", "E"))), center + Vector2(0, cell * 0.1), int(cell * 0.42), ACCENT)
		"DIRECTION":
			draw_centered(canvas, direction_glyph(str(tile.get("direction", "E"))), center + Vector2(0, cell * 0.1), int(cell * 0.42), MAP_PURPLE)
		"COLOR":
			var color := Color("438dff") if tile.get("color", "BLUE") == "BLUE" else YELLOW
			canvas.draw_circle(center, cell * 0.22, Color(color, 0.6))

func draw_robot(canvas: CanvasItem, center: Vector2, cell: float, direction: String) -> void:
	canvas.draw_arc(center, cell * 0.26, 0, TAU, 48, BLUE, 5.0)
	draw_arrow_centered(canvas, direction_glyph(direction), center, int(cell * 0.42), Color.WHITE)

func draw_arrow_centered(canvas: CanvasItem, text: String, center: Vector2, font_size: int, color: Color) -> void:
	var font := ThemeDB.fallback_font
	var advance: float = font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x
	var pen := center + Vector2(-advance * 0.5, 0.325 * font_size)
	canvas.draw_string(font, pen, text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, color)

func direction_glyph(direction: String) -> String:
	return {"N": "↑", "E": "→", "S": "↓", "W": "←"}.get(direction, "→")

func draw_centered(canvas: CanvasItem, text: String, center: Vector2, font_size: int, color: Color) -> void:
	var font := ThemeDB.fallback_font
	var text_size := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size)
	canvas.draw_string(font, center - Vector2(text_size.x * 0.5, -text_size.y * 0.5), text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, color)
