extends Node

var player: AudioStreamPlayer
var generator: AudioStreamGenerator

func _ready() -> void:
	player = AudioStreamPlayer.new()
	generator = AudioStreamGenerator.new()
	generator.mix_rate = 22050.0
	generator.buffer_length = 0.6
	player.stream = generator
	player.volume_db = -13.0
	add_child(player)
	player.play()

func play_cue(cue: String) -> void:
	if not player.playing:
		player.play()
	var playback := player.get_stream_playback() as AudioStreamGeneratorPlayback
	if playback == null:
		return
	var notes: Array[float] = []
	match cue:
		"vote": notes = [440.0, 554.0]
		"compile": notes = [330.0, 440.0, 660.0]
		"execute": notes = [220.0, 277.0, 330.0]
		"success": notes = [523.0, 659.0, 784.0, 1047.0]
		"debug": notes = [196.0, 185.0, 174.0]
		"step": notes = [392.0]
		"collision": notes = [147.0, 110.0]
		"fix": notes = [392.0, 587.0]
		_: notes = [330.0]
	var frames := PackedVector2Array()
	var sample_rate := generator.mix_rate
	var note_duration := 0.09
	for note in notes:
		var sample_count := int(sample_rate * note_duration)
		for index in range(sample_count):
			var progress := float(index) / float(sample_count)
			var envelope := sin(progress * PI)
			var sample := sin(TAU * note * float(index) / sample_rate) * envelope * 0.18
			frames.push_back(Vector2(sample, sample))
	playback.push_buffer(frames)

func set_volume(master: float, effects: float) -> void:
	var linear := clampf(master * effects, 0.0, 1.0)
	player.volume_db = linear_to_db(linear) if linear > 0.001 else -80.0
