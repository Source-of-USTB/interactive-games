extends RefCounted

const BG := Color("071210")
const ACCENT := Color("5de4c7")
const PURPLE := Color("8ecfc4")
const GREEN := Color("b7ef79")
const YELLOW := Color("f6c878")
const MUTED := Color("8baba4")
const PANEL := Color("0e1d1b")
const CARD_BG := Color("132724")
const DANGER := Color("ff8d7c")
const INK := Color("eaf7f2")

const MAP_BG := Color("081714")
const MAP_GRID := Color("35544b")
const MAP_FLOOR := Color("19332c")
const MAP_PURPLE := Color("8ecfc4")
const MAP_RED := Color("ff8d7c")
const BLUE := Color("65cbfa")

var _art: Dictionary = {}

func texture(asset: String) -> Texture2D:
	if not _art.has(asset):
		var path := "res://assets/art/" + asset + ".png"
		_art[asset] = load(path) if ResourceLoader.exists(path) else null
	return _art[asset] as Texture2D

func label(text: String, font_size: int, color: Color) -> Label:
	var item := Label.new()
	item.text = text
	item.add_theme_font_size_override("font_size", font_size)
	item.add_theme_color_override("font_color", color)
	return item

func surface(color: Color, radius: int = 18, border: Color = Color(ACCENT, 0.16)) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.border_color = border
	style.set_border_width_all(1)
	style.set_corner_radius_all(radius)
	style.anti_aliasing = true
	return style

func pill(text: String, color: Color) -> Label:
	var item := label(text, 20, color)
	item.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	item.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	item.add_theme_stylebox_override("normal", surface(Color(color, 0.08), 12, Color(color, 0.23)))
	return item

func panel(color: Color, radius: int) -> Panel:
	var item := Panel.new()
	var style := surface(color, radius)
	style.shadow_color = Color(0, 0, 0, 0.2)
	style.shadow_size = 12
	style.shadow_offset = Vector2(0, 8)
	item.add_theme_stylebox_override("panel", style)
	return item

func draw_background(canvas: CanvasItem) -> void:
	canvas.draw_rect(Rect2(Vector2.ZERO, canvas.size), BG, true)
	var backdrop := texture("city-backdrop")
	if backdrop != null:
		canvas.draw_texture_rect(backdrop, Rect2(Vector2.ZERO, canvas.size), false, Color(0.55, 0.7, 0.64, 0.24))
	for x in range(0, int(canvas.size.x), 96):
		canvas.draw_line(Vector2(x, 0), Vector2(x, canvas.size.y), Color(ACCENT, 0.018), 1.0)
	canvas.draw_line(Vector2(48, 92), Vector2(canvas.size.x - 48, 92), Color(ACCENT, 0.18), 1.0)
	canvas.draw_line(Vector2(48, 92), Vector2(132, 92), ACCENT, 2.0)
	canvas.draw_line(Vector2(48, canvas.size.y - 78), Vector2(canvas.size.x - 48, canvas.size.y - 78), Color(ACCENT, 0.13), 1.0)

func draw_map_background(canvas: CanvasItem, cell: float, origin: Vector2, width: int, height: int) -> void:
	var board := Rect2(origin, Vector2(width, height) * cell)
	canvas.draw_style_box(surface(Color("071310"), 14, Color(ACCENT, 0.22)), board.grow(10))
	var floor_texture := texture("floor")
	for y in range(height):
		for x in range(width):
			var rect := Rect2(origin + Vector2(x, y) * cell + Vector2(2, 2), Vector2(cell - 4, cell - 4))
			canvas.draw_style_box(surface(MAP_FLOOR, 6, Color(MAP_GRID, 0.68)), rect)
			if floor_texture != null:
				canvas.draw_texture_rect(floor_texture, rect.grow(-1), false, Color(0.76, 0.9, 0.81, 0.8))
			canvas.draw_line(rect.position + Vector2(5, 1), rect.position + Vector2(rect.size.x - 5, 1), Color(ACCENT, 0.12), 1.0)
	for x in range(width):
		draw_centered(canvas, str(x + 1).pad_zeros(2), origin + Vector2((x + 0.5) * cell, -24), 13, MUTED)
	for y in range(height):
		draw_centered(canvas, String.chr(65 + y), origin + Vector2(-23, (y + 0.5) * cell - 4), 13, MUTED)
	var corner := 16.0
	for point in [board.position - Vector2(10, 10), board.end + Vector2(10, 10)]:
		var sign_value := 1.0 if point == board.position - Vector2(10, 10) else -1.0
		canvas.draw_line(point, point + Vector2(corner * sign_value, 0), ACCENT, 2.0)
		canvas.draw_line(point, point + Vector2(0, corner * sign_value), ACCENT, 2.0)

func draw_goal(canvas: CanvasItem, center: Vector2, cell: float) -> void:
	canvas.draw_circle(center, cell * 0.37, Color(BLUE, 0.08))
	canvas.draw_arc(center, cell * 0.31, 0, TAU, 48, Color(BLUE, 0.35), 2.0, true)
	canvas.draw_arc(center, cell * 0.25, 0, TAU, 40, BLUE, 3.0, true)
	var crystal := PackedVector2Array([center + Vector2(0, -0.2) * cell, center + Vector2(0.14, 0) * cell, center + Vector2(0, 0.2) * cell, center + Vector2(-0.14, 0) * cell])
	canvas.draw_colored_polygon(crystal, Color(BLUE, 0.75))
	canvas.draw_line(center + Vector2(0, -0.2) * cell, center + Vector2(0, 0.2) * cell, Color.WHITE, 1.5, true)

func draw_tile(canvas: CanvasItem, tile: Dictionary, center: Vector2, cell: float, active_switches: Array, collected_chips: Array) -> void:
	var kind := str(tile.get("kind", ""))
	match kind:
		"WALL":
			var rect := Rect2(center - Vector2.ONE * cell * 0.46, Vector2.ONE * cell * 0.92)
			canvas.draw_style_box(surface(Color("22312d"), 7, Color("516b60")), rect)
			var wall_texture := texture("wall")
			if wall_texture != null:
				canvas.draw_texture_rect(wall_texture, rect, false)
			else:
				canvas.draw_rect(rect.grow(-cell * 0.12), Color("30463d"), true)
				canvas.draw_line(rect.position + Vector2(cell * 0.12, cell * 0.12), rect.end - Vector2(cell * 0.12, cell * 0.12), Color("5a7264"), 3.0)
		"CHIP":
			if not str(tile.get("id", "")) in collected_chips:
				canvas.draw_circle(center, cell * 0.31, Color(YELLOW, 0.08))
				canvas.draw_arc(center, cell * 0.28, 0, TAU, 32, Color(YELLOW, 0.3), 1.5, true)
				canvas.draw_style_box(surface(Color("725932"), 5, YELLOW), Rect2(center - Vector2.ONE * cell * 0.16, Vector2.ONE * cell * 0.32))
				canvas.draw_rect(Rect2(center - Vector2.ONE * cell * 0.07, Vector2.ONE * cell * 0.14), YELLOW, true)
				for pin in [-1, 0, 1]:
					for side in [-1, 1]:
						canvas.draw_line(center + Vector2(pin * 0.08, side * 0.16) * cell, center + Vector2(pin * 0.08, side * 0.23) * cell, YELLOW, 2.0)
						canvas.draw_line(center + Vector2(side * 0.16, pin * 0.08) * cell, center + Vector2(side * 0.23, pin * 0.08) * cell, YELLOW, 2.0)
		"SWITCH":
			var active := str(tile.get("id", "")) in active_switches
			var switch_color := GREEN if active else ACCENT
			canvas.draw_circle(center, cell * 0.27, Color(switch_color, 0.1))
			canvas.draw_arc(center, cell * 0.22, -1.1, 4.2, 32, switch_color, 4.0, true)
			canvas.draw_line(center + Vector2(0, -cell * 0.28), center + Vector2(0, -cell * 0.03), switch_color, 4.0, true)
			if active: canvas.draw_circle(center + Vector2(0, cell * 0.08), cell * 0.04, GREEN)
		"DOOR":
			var open := str(tile.get("switchId", "")) in active_switches
			var door_color := GREEN if open else MAP_RED
			for side in [-1, 1]:
				canvas.draw_style_box(surface(Color("263931"), 4, Color(door_color, 0.7)), Rect2(center + Vector2(side * cell * 0.3 - cell * 0.05, -cell * 0.32), Vector2(cell * 0.1, cell * 0.64)))
			if not open:
				canvas.draw_rect(Rect2(center - Vector2(cell * 0.27, cell * 0.28), Vector2(cell * 0.54, cell * 0.56)), Color(door_color, 0.14), true)
				for rail in [-1, 0, 1]:
					canvas.draw_line(center + Vector2(-cell * 0.28, rail * cell * 0.16), center + Vector2(cell * 0.28, rail * cell * 0.16), Color(door_color, 0.8), 2.0)
		"CONVEYOR":
			canvas.draw_rect(Rect2(center - Vector2.ONE * cell * 0.35, Vector2.ONE * cell * 0.7), Color(ACCENT, 0.08), true)
			draw_arrow_centered(canvas, direction_glyph(str(tile.get("direction", "E"))), center, int(cell * 0.42), ACCENT)
		"DIRECTION":
			draw_arrow_centered(canvas, direction_glyph(str(tile.get("direction", "E"))), center, int(cell * 0.42), GREEN)
		"COLOR":
			var color := BLUE if tile.get("color", "BLUE") == "BLUE" else YELLOW
			canvas.draw_circle(center, cell * 0.25, Color(color, 0.16))
			canvas.draw_arc(center, cell * 0.22, 0, TAU, 32, color, 2.0, true)
			canvas.draw_circle(center, cell * 0.10, color)

func draw_robot(canvas: CanvasItem, center: Vector2, cell: float, direction: String) -> void:
	canvas.draw_circle(center + Vector2(0, cell * 0.16), cell * 0.32, Color(0, 0, 0, 0.28))
	canvas.draw_arc(center + Vector2(0, cell * 0.10), cell * 0.32, 0, TAU, 48, Color(ACCENT, 0.45), 2.5, true)
	var robot := texture("robot")
	if robot != null:
		canvas.draw_texture_rect(robot, Rect2(center - Vector2(cell * 0.40, cell * 0.48), Vector2.ONE * cell * 0.80), false)
	else:
		canvas.draw_style_box(surface(Color("c3e3d5"), int(cell * 0.1), INK), Rect2(center - Vector2(cell * 0.21, cell * 0.27), Vector2(cell * 0.42, cell * 0.48)))
		canvas.draw_style_box(surface(BG, 5, ACCENT), Rect2(center - Vector2(cell * 0.17, cell * 0.2), Vector2(cell * 0.34, cell * 0.18)))
		for eye in [-1, 1]: canvas.draw_circle(center + Vector2(eye * cell * 0.07, -cell * 0.11), cell * 0.025, ACCENT)
	var facing: Vector2 = {"N": Vector2.UP, "E": Vector2.RIGHT, "S": Vector2.DOWN, "W": Vector2.LEFT}.get(direction, Vector2.RIGHT)
	var side := facing.orthogonal()
	var tip := center + facing * cell * 0.47
	canvas.draw_colored_polygon(PackedVector2Array([tip, tip - facing * cell * 0.15 + side * cell * 0.09, tip - facing * cell * 0.15 - side * cell * 0.09]), ACCENT)

func draw_arrow_centered(canvas: CanvasItem, text: String, center: Vector2, font_size: int, color: Color) -> void:
	var font := ThemeDB.fallback_font
	var text_size := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size)
	var pen := center + Vector2(-text_size.x * 0.5, font.get_ascent(font_size) * 0.5 - font.get_descent(font_size) * 0.5)
	canvas.draw_string(font, pen, text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, color)

func direction_glyph(direction: String) -> String:
	return {"N": "↑", "E": "→", "S": "↓", "W": "←"}.get(direction, "→")

func draw_centered(canvas: CanvasItem, text: String, center: Vector2, font_size: int, color: Color) -> void:
	draw_arrow_centered(canvas, text, center, font_size, color)
