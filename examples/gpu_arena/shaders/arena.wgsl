struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32,
           @builtin(instance_index) instance_index: u32) -> VertexOut {
  var positions = array<vec2f, 3>(
    vec2f(0.0, 0.16),
    vec2f(-0.18, -0.14),
    vec2f(0.18, -0.14)
  );
  let lane = f32(instance_index % 6u);
  let row = f32(instance_index / 6u);
  let x = -0.72 + lane * 0.29;
  let y = -0.08 + row * 0.24;
  let scale = 1.0 + 0.15 * f32(instance_index % 3u);
  var out: VertexOut;
  out.position = vec4f(positions[vertex_index] * scale + vec2f(x, y), 0.0, 1.0);
  out.color = vec4f(0.12 + lane * 0.12, 0.34 + row * 0.28, 1.0 - lane * 0.08, 1.0);
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  return in.color;
}
