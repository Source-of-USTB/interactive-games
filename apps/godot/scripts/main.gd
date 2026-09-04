extends Control

const MapRenderer = preload("res://scripts/map_renderer.gd")
const ProgramPanel = preload("res://scripts/program_panel.gd")
const ProceduralAudio = preload("res://scripts/procedural_audio.gd")

const Ui = preload("res://scripts/theme.gd")
const ACCENT := Ui.ACCENT
const PURPLE := Ui.PURPLE
const GREEN := Ui.GREEN
const YELLOW := Ui.YELLOW
const MUTED := Ui.MUTED
const PANEL := Ui.PANEL

var websocket := WebSocketPeer.new()
var websocket_url := "ws://127.0.0.1:3000/ws"
var screen_token := "development-admin-token"
var http_origin := "http://127.0.0.1:3000"
var connection_state := "连接中"
var connected := false
var connecting := false
var connect_started_ms := 0
var next_reconnect_ms := 0
var reconnect_attempt := 0
var last_ack_ms := 0
var server_clock_offset_ms := 0.0
var state: Dictionary = {}
var daily: Dictionary = {}
var last_phase := ""
var offline_demo := false
var forced_demo := false
var offline_phase_index := 0
var offline_next_phase_ms := 0
var last_envelope_sequence := -1
var last_played_trace_sequence := -1
var last_locked_vote_key := ""
var display_settings: Dictionary = {"qrMode": "public", "masterVolume": 0.8, "effectsVolume": 0.8, "showVoteTrends": true, "demoMode": false}
var ui := Ui.new()

var phase_names := {
	"ATTRACT": "等待启动", "JOIN": "扫码加入", "AUTHORING": "全场写代码",
	"COMPILE": "人类编译中", "EXECUTE": "代码执行中", "PAUSED": "现场已暂停"
}

var header_title: Label
var phase_label: Label
var player_label: Label
var countdown_label: Label
var connection_label: Label
var mission_label: Label
var map_meta_label: Label
var knowledge_label: Label
var status_label: Label
var footer_label: Label
var qr_texture: TextureRect
var qr_backing: Panel
var qr_hint: Label
var map_renderer
var program_panel
var vote_box: VBoxContainer
var audio_cues
var http_request: HTTPRequest

func _ready() -> void:
	ThemeDB.fallback_font = load("res://assets/fonts/NotoSansSC-Regular.otf")
	websocket_url = OS.get_environment("GAME_SERVER_WS")
	if websocket_url.is_empty(): websocket_url = "ws://127.0.0.1:3000/ws"
	screen_token = OS.get_environment("SCREEN_TOKEN")
	if screen_token.is_empty(): screen_token = "development-admin-token"
	http_origin = _http_origin_from_ws(websocket_url)
	_build_interface()
	_connect_websocket()
	http_request.request(http_origin + "/api/qr.png")
	set_process(true)

func _process(_delta: float) -> void:
	_poll_websocket()
	var now := Time.get_ticks_msec()
	if connected and now - last_ack_ms > 2000:
		_send({"protocolVersion": 1, "type": "screen.ack", "requestId": "screen-" + str(now), "sequence": map_renderer.max_displayed_sequence, "roomId": state.get("roomId", "MAIN"), "roundId": state.get("roundId", "")})
		last_ack_ms = now
	if not connected and not connecting and now >= next_reconnect_ms:
		_connect_websocket()
	if not connected and not offline_demo and connect_started_ms > 0 and now - connect_started_ms > 10000:
		_enable_offline_demo()
	if offline_demo and (not connected or forced_demo):
		_tick_offline_demo(now)
	if not state.is_empty():
		var corrected_now := float(Time.get_ticks_msec()) + server_clock_offset_ms
		map_renderer.playback_at(corrected_now)
		program_panel.set_active_line(map_renderer.current_line)
		if map_renderer.current_sequence >= 0 and map_renderer.current_sequence != last_played_trace_sequence:
			last_played_trace_sequence = map_renderer.current_sequence
			audio_cues.play_cue("collision" if map_renderer.current_event_type == "FAILURE" else "step")
		_update_countdown(corrected_now)

func _draw() -> void:
	ui.draw_background(self)

func _build_interface() -> void:
	queue_redraw()
	var brand_icon := ui.pill("{ }", ACCENT)
	brand_icon.position = Vector2(48, 26)
	brand_icon.size = Vector2(52, 52)
	brand_icon.add_theme_font_size_override("font_size", 28)
	add_child(brand_icon)
	header_title = ui.label("全场一起写代码", 32, ui.INK)
	header_title.position = Vector2(116, 20)
	header_title.size = Vector2(470, 44)
	add_child(header_title)
	var brand_caption := ui.label("CROWD CODE  /  城市协作终端", 15, MUTED)
	brand_caption.position = Vector2(118, 62)
	add_child(brand_caption)

	phase_label = ui.pill("连接中", ACCENT)
	phase_label.position = Vector2(758, 26)
	phase_label.size = Vector2(310, 52)
	phase_label.add_theme_font_size_override("font_size", 26)
	add_child(phase_label)
	player_label = ui.label("0 人参与", 25, ui.INK)
	player_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	player_label.position = Vector2(1120, 31)
	player_label.size = Vector2(230, 42)
	add_child(player_label)
	countdown_label = ui.pill("--", YELLOW)
	countdown_label.add_theme_font_size_override("font_size", 29)
	countdown_label.position = Vector2(1392, 26)
	countdown_label.size = Vector2(120, 52)
	add_child(countdown_label)
	connection_label = ui.pill("● 连接中", MUTED)
	connection_label.position = Vector2(1570, 32)
	connection_label.size = Vector2(302, 40)
	add_child(connection_label)

	mission_label = ui.label("正在同步任务…", 28, ui.INK)
	mission_label.position = Vector2(48, 108)
	mission_label.size = Vector2(1160, 44)
	mission_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	add_child(mission_label)
	map_meta_label = ui.label("城市编程系统", 19, MUTED)
	map_meta_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	map_meta_label.position = Vector2(1232, 112)
	map_meta_label.size = Vector2(640, 38)
	add_child(map_meta_label)

	var map_panel := ui.panel(Color(PANEL, 0.96), 22)
	map_panel.position = Vector2(48, 165)
	map_panel.size = Vector2(1160, 820)
	add_child(map_panel)
	var map_title := ui.label("城市任务地图", 21, ui.INK)
	map_title.position = Vector2(26, 16)
	map_panel.add_child(map_title)
	var map_caption := ui.label("CITY GRID  /  实时同步", 15, MUTED)
	map_caption.position = Vector2(800, 22)
	map_caption.size = Vector2(334, 28)
	map_caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	map_panel.add_child(map_caption)
	map_renderer = MapRenderer.new()
	map_renderer.position = Vector2(16, 56)
	map_renderer.size = Vector2(1128, 702)
	map_renderer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	map_panel.add_child(map_renderer)
	knowledge_label = ui.label("按顺序编写指令，让小码抵达目标。", 18, MUTED)
	knowledge_label.position = Vector2(28, 774)
	knowledge_label.size = Vector2(1104, 30)
	knowledge_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	map_panel.add_child(knowledge_label)

	var qr_panel := ui.panel(ui.CARD_BG, 22)
	qr_panel.position = Vector2(1232, 165)
	qr_panel.size = Vector2(640, 177)
	add_child(qr_panel)
	qr_backing = ui.panel(Color.WHITE, 12)
	qr_backing.position = Vector2(19, 19)
	qr_backing.size = Vector2(139, 139)
	qr_panel.add_child(qr_backing)
	var qr_placeholder := ui.label("等待连接", 18, ui.PANEL)
	qr_placeholder.position = Vector2(10, 50)
	qr_placeholder.size = Vector2(119, 36)
	qr_placeholder.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	qr_backing.add_child(qr_placeholder)
	qr_texture = TextureRect.new()
	qr_texture.position = Vector2(27, 27)
	qr_texture.size = Vector2(123, 123)
	qr_texture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	qr_texture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	qr_panel.add_child(qr_texture)
	var join_caption := ui.label("加入协作  /  JOIN THE MISSION", 15, ACCENT)
	join_caption.position = Vector2(183, 25)
	qr_panel.add_child(join_caption)
	qr_hint = ui.label("扫码提交下一条指令\n无需下载 · 无需注册", 24, ui.INK)
	qr_hint.position = Vector2(181, 59)
	qr_hint.size = Vector2(440, 92)
	qr_hint.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	qr_hint.add_theme_constant_override("line_spacing", 12)
	qr_panel.add_child(qr_hint)

	var program_host := ui.panel(PANEL, 22)
	program_host.position = Vector2(1232, 363)
	program_host.size = Vector2(640, 431)
	add_child(program_host)
	program_panel = ProgramPanel.new()
	program_panel.position = Vector2(2, 2)
	program_panel.size = Vector2(636, 427)
	program_host.add_child(program_panel)

	var vote_host := ui.panel(Color(PANEL, 0.96), 22)
	vote_host.position = Vector2(1232, 815)
	vote_host.size = Vector2(640, 170)
	add_child(vote_host)
	var vote_title := ui.label("全场决策", 19, ui.INK)
	vote_title.position = Vector2(24, 12)
	vote_host.add_child(vote_title)
	var vote_caption := ui.label("LIVE VOTE", 13, MUTED)
	vote_caption.position = Vector2(494, 18)
	vote_host.add_child(vote_caption)
	vote_box = VBoxContainer.new()
	vote_box.position = Vector2(1256, 861)
	vote_box.size = Vector2(592, 112)
	vote_box.add_theme_constant_override("separation", 4)
	add_child(vote_box)

	status_label = ui.label("服务启动中", 16, MUTED)
	status_label.position = Vector2(48, 1020)
	status_label.size = Vector2(750, 30)
	add_child(status_label)
	footer_label = ui.label("今日 0 人次 · 0 条指令 · 城市能量 0", 16, MUTED)
	footer_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	footer_label.position = Vector2(850, 1020)
	footer_label.size = Vector2(1022, 30)
	add_child(footer_label)

	audio_cues = ProceduralAudio.new()
	add_child(audio_cues)
	http_request = HTTPRequest.new()
	http_request.timeout = 8.0
	http_request.request_completed.connect(_on_qr_completed)
	add_child(http_request)

func _connect_websocket() -> void:
	if connecting or connected:
		return
	websocket = WebSocketPeer.new()
	var separator := "&" if "?" in websocket_url else "?"
	var url := websocket_url + separator + "role=screen&token=" + screen_token.uri_encode()
	var error := websocket.connect_to_url(url)
	connect_started_ms = Time.get_ticks_msec()
	if error != OK:
		connection_state = "等待重连"
		next_reconnect_ms = connect_started_ms + 1500
		connecting = false
		_update_connection_ui()
		return
	connecting = true
	connection_state = "连接中"
	_update_connection_ui()

func _poll_websocket() -> void:
	websocket.poll()
	var ready_state := websocket.get_ready_state()
	if ready_state == WebSocketPeer.STATE_OPEN:
		if not connected:
			connected = true
			connecting = false
			offline_demo = false
			reconnect_attempt = 0
			connection_state = "实时已连接"
			_update_connection_ui()
		while websocket.get_available_packet_count() > 0:
			var text := websocket.get_packet().get_string_from_utf8()
			_on_message(text)
	elif ready_state == WebSocketPeer.STATE_CLOSED and (connected or connecting):
		connected = false
		connecting = false
		reconnect_attempt += 1
		var delay := mini(10000, 700 * int(pow(2, mini(reconnect_attempt, 4))))
		next_reconnect_ms = Time.get_ticks_msec() + delay
		connection_state = "自动重连中"
		_update_connection_ui()

func _on_message(text: String) -> void:
	var message = JSON.parse_string(text)
	if not message is Dictionary:
		return
	if message.has("serverTimestamp"):
		server_clock_offset_ms = float(message.serverTimestamp) - float(Time.get_ticks_msec())
	last_envelope_sequence = int(message.get("sequence", last_envelope_sequence))
	var message_type := str(message.get("type", ""))
	if message_type not in ["session.welcome", "state.snapshot"]:
		return
	var payload: Dictionary = message.get("payload", {})
	if payload.has("settings"):
		_apply_display_settings(payload.get("settings", {}))
		if forced_demo:
			return
	var next_state: Dictionary = payload.get("state", {})
	daily = payload.get("daily", {})
	_apply_state(next_state)

func _send(message: Dictionary) -> void:
	if websocket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		websocket.send_text(JSON.stringify(message))

func _apply_state(next_state: Dictionary) -> void:
	if next_state.is_empty(): return
	state = next_state
	map_renderer.set_state(state)
	program_panel.set_state(state)
	var map: Dictionary = state.get("map", {})
	mission_label.text = str(map.get("mission", "等待任务"))
	knowledge_label.text = "编程提示  /  " + str(map.get("knowledgePoint", "按顺序编写指令，让小码抵达目标。"))
	map_meta_label.text = "第 %s 章  ·  难度 %s  ·  %s" % [int(map.get("chapter", 1)), int(map.get("difficulty", 1)), map.get("name", "")]
	var phase := str(state.get("phase", "ATTRACT"))
	phase_label.text = str(phase_names.get(phase, phase))
	var phase_color: Color = {"AUTHORING": ACCENT, "EXECUTE": GREEN, "COMPILE": YELLOW, "PAUSED": YELLOW}.get(phase, ACCENT)
	phase_label.add_theme_color_override("font_color", phase_color)
	phase_label.add_theme_stylebox_override("normal", ui.surface(Color(phase_color, 0.08), 12, Color(phase_color, 0.23)))
	player_label.text = str(int(state.get("connectedPlayers", 0))) + " 人参与"
	status_label.text = "房间 %s  ·  轮次 %s  ·  %s" % [state.get("roomId", "MAIN"), state.get("roundId", "--"), state.get("mode", "COCODE")]
	footer_label.text = "今日 %s 人次 · %s 条指令 · 修复 %s 个 Bug · 城市能量 %s" % [int(daily.get("participantSessions", 0)), int(daily.get("commandsSubmitted", 0)), int(daily.get("bugsFixed", 0)), int(daily.get("cityEnergy", 0))]
	_update_vote_bars()
	var tally: Dictionary = state.get("currentTally", {})
	var locked_vote_key := str(state.get("roundId", "")) + ":" + str(tally.get("slotId", ""))
	if tally.get("locked", false) and locked_vote_key != last_locked_vote_key:
		last_locked_vote_key = locked_vote_key
		audio_cues.play_cue("vote")
	if phase != last_phase:
		_play_phase_cue(phase)
		last_phase = phase

func _update_countdown(corrected_now: float) -> void:
	var ends_at := float(state.get("phaseEndsAt", 0))
	if ends_at <= 0:
		countdown_label.text = "∞"
		return
	var remaining := maxi(0, int(ceil((ends_at - corrected_now) / 1000.0)))
	countdown_label.text = str(remaining).pad_zeros(2)
	countdown_label.add_theme_color_override("font_color", ui.DANGER if remaining <= 3 else YELLOW)

func _update_vote_bars() -> void:
	for child in vote_box.get_children(): child.queue_free()
	var tally: Dictionary = state.get("currentTally", {})
	if tally.is_empty():
		var waiting := ui.label(_phase_prompt(str(state.get("phase", ""))), 22, MUTED)
		waiting.size_flags_vertical = Control.SIZE_EXPAND_FILL
		waiting.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		vote_box.add_child(waiting)
		return
	if not display_settings.get("showVoteTrends", true) and not tally.get("locked", false):
		var pulse := ui.label(str(int(tally.get("submittedCount", 0))) + " 位同学已参与，选项分布暂时隐藏", 22, ACCENT)
		pulse.size_flags_vertical = Control.SIZE_EXPAND_FILL
		pulse.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		vote_box.add_child(pulse)
		return
	var options: Array = tally.get("options", [])
	var max_votes := 1
	for raw_option in options: max_votes = maxi(max_votes, int(raw_option.get("count", 0)))
	for raw_option in options:
		var option: Dictionary = raw_option
		var row := HBoxContainer.new()
		var value := ui.label(_choice_label(option.get("value", "")), 20, Color.WHITE)
		value.custom_minimum_size = Vector2(150, 32)
		row.add_child(value)
		var progress := ProgressBar.new()
		progress.show_percentage = false
		progress.add_theme_stylebox_override("background", ui.surface(Color(ACCENT, 0.07), 5, Color.TRANSPARENT))
		progress.add_theme_stylebox_override("fill", ui.surface(Color(ACCENT, 0.7), 5, Color.TRANSPARENT))
		progress.max_value = max_votes
		progress.value = option.get("count", 0)
		progress.custom_minimum_size = Vector2(330, 12)
		progress.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		progress.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(progress)
		var count := ui.label(str(int(option.get("count", 0))) if tally.get("locked", false) else "", 20, ACCENT)
		count.custom_minimum_size = Vector2(42, 32)
		count.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		row.add_child(count)
		vote_box.add_child(row)

func _phase_prompt(phase: String) -> String:
	return {"JOIN": "扫码加入并查看地图与任务目标", "COMPILE": "程序已锁定，正在编译", "EXECUTE": "指令正在城市中执行"}.get(phase, "等待下一个全场决策")

func _choice_label(value) -> String:
	if value is int or value is float: return "循环 ×" + str(int(value))
	return {"MOVE": "↑ 前进", "TURN_LEFT": "← 左转", "TURN_RIGHT": "→ 右转"}.get(str(value), str(value))

func _play_phase_cue(phase: String) -> void:
	if phase == "AUTHORING": audio_cues.play_cue("vote")
	elif phase == "COMPILE": audio_cues.play_cue("compile")
	elif phase == "EXECUTE": audio_cues.play_cue("execute")

func _update_connection_ui() -> void:
	connection_label.text = ("● " if connected else "◌ ") + connection_state
	connection_label.add_theme_color_override("font_color", GREEN if connected else MUTED)

func _on_qr_completed(result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	if result != HTTPRequest.RESULT_SUCCESS or response_code != 200:
		qr_hint.text = "打开手机浏览器\n" + http_origin
		return
	var image := Image.new()
	if image.load_png_from_buffer(body) == OK:
		qr_texture.texture = ImageTexture.create_from_image(image)

func _apply_display_settings(next_settings: Dictionary) -> void:
	var previous_qr_mode := str(display_settings.get("qrMode", "public"))
	display_settings = next_settings.duplicate(true)
	forced_demo = bool(display_settings.get("demoMode", false))
	audio_cues.set_volume(float(display_settings.get("masterVolume", 0.8)), float(display_settings.get("effectsVolume", 0.8)))
	var qr_mode := str(display_settings.get("qrMode", "public"))
	qr_texture.visible = qr_mode != "hidden"
	qr_backing.visible = qr_mode != "hidden"
	qr_hint.text = "当前为只演示模式" if qr_mode == "hidden" else ("连接现场 Wi-Fi 后扫码\n无需下载 · 无需注册" if qr_mode == "local" else "扫码提交下一条指令\n无需下载 · 无需注册")
	if qr_mode != "hidden" and (qr_mode != previous_qr_mode or qr_texture.texture == null):
		if http_request.get_http_client_status() == HTTPClient.STATUS_DISCONNECTED:
			http_request.request(http_origin + "/api/qr.png?mode=" + qr_mode)
	if forced_demo and not offline_demo:
		_enable_offline_demo()
	elif not forced_demo and connected:
		offline_demo = false

func _enable_offline_demo() -> void:
	offline_demo = true
	connection_state = "离线演示"
	_update_connection_ui()
	state = _offline_state()
	daily = {"participantSessions": 128, "commandsSubmitted": 416, "bugsFixed": 37, "cityEnergy": 860}
	_apply_state(state)
	offline_next_phase_ms = Time.get_ticks_msec() + 6000

func _tick_offline_demo(now: int) -> void:
	if now < offline_next_phase_ms: return
	var phases := ["JOIN", "AUTHORING", "COMPILE", "EXECUTE"]
	offline_phase_index = (offline_phase_index + 1) % phases.size()
	state.phase = phases[offline_phase_index]
	state.phaseStartedAt = now + server_clock_offset_ms
	state.phaseEndsAt = state.phaseStartedAt + 6000
	if state.phase == "AUTHORING":
		state.currentTally = {"slotId": "move_1", "options": [{"value": "MOVE", "count": 42}, {"value": "TURN_LEFT", "count": 11}, {"value": "TURN_RIGHT", "count": 8}], "eligibleCount": 88, "submittedCount": 61, "locked": false}
	else: state.erase("currentTally")
	_apply_state(state)
	offline_next_phase_ms = now + 6000

func _offline_state() -> Dictionary:
	var start := {"x": 0, "y": 3, "direction": "E", "activeSwitches": [], "collectedChips": []}
	var finish := {"x": 4, "y": 1, "direction": "N", "activeSwitches": ["s1"], "collectedChips": ["c1"]}
	return {"roomId": "DEMO", "roundId": "offline-preview", "mode": "COCODE", "phase": "JOIN", "phaseStartedAt": Time.get_ticks_msec(), "phaseEndsAt": Time.get_ticks_msec() + 6000, "serverNow": Time.get_ticks_msec(), "connectedPlayers": 88, "map": {"id": "demo", "name": "能量站穿越", "chapter": 2, "difficulty": 3, "width": 7, "height": 5, "start": start, "goal": {"x": 5, "y": 1}, "tiles": [{"kind": "WALL", "x": 2, "y": 2}, {"kind": "WALL", "x": 3, "y": 2}, {"kind": "CHIP", "id": "c1", "x": 2, "y": 3}, {"kind": "SWITCH", "id": "s1", "x": 4, "y": 3}, {"kind": "DOOR", "switchId": "s1", "x": 4, "y": 2}, {"kind": "CONVEYOR", "direction": "N", "x": 4, "y": 1}], "mission": "收集数据芯片，启动开关后抵达能量核心", "knowledgePoint": "用有序指令把复杂任务拆成可验证步骤", "previewFocus": []}, "slots": [{"slotId": "move_1", "line": 1, "prompt": "移动到芯片", "kind": "command", "options": ["MOVE", "TURN_LEFT", "TURN_RIGHT"]}, {"slotId": "turn_1", "line": 2, "prompt": "转向能量门", "kind": "command", "options": ["MOVE", "TURN_LEFT", "TURN_RIGHT"]}, {"slotId": "repeat", "line": 3, "prompt": "重复次数", "kind": "number", "options": [2, 3, 4]}], "currentSlotIndex": 0, "lockedChoices": {"move_1": "MOVE", "turn_1": "TURN_LEFT", "repeat": 2}, "trace": [{"sequence": 0, "type": "ACTION", "sourceLine": 1, "command": "MOVE", "label": "前进", "before": start, "after": {"x": 2, "y": 3, "direction": "E", "activeSwitches": [], "collectedChips": ["c1"]}, "durationMs": 1100}, {"sequence": 1, "type": "ACTION", "sourceLine": 2, "command": "TURN_LEFT", "label": "左转", "before": {"x": 2, "y": 3, "direction": "E", "activeSwitches": [], "collectedChips": ["c1"]}, "after": {"x": 4, "y": 3, "direction": "N", "activeSwitches": ["s1"], "collectedChips": ["c1"]}, "durationMs": 1200}, {"sequence": 2, "type": "SUCCESS", "sourceLine": 3, "label": "到达目标", "before": finish, "after": finish, "durationMs": 900}]}

func _http_origin_from_ws(url: String) -> String:
	var value := url.replace("wss://", "https://").replace("ws://", "http://")
	var path_position := value.find("/ws")
	return value.left(path_position) if path_position >= 0 else value
