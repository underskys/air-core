struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32,
           @builtin(instance_index) instance_index: u32) -> VertexOut {
  var triangle = array<vec2f, 3>(
    vec2f(0.0, 0.18),
    vec2f(-0.2, -0.15),
    vec2f(0.2, -0.15)
  );
  let lane = f32(instance_index % 9u);
  let row = f32(instance_index / 9u);
  let orbit = f32((instance_index * 37u) % 360u) * 0.0174532925;
  let radius = 0.16 + 0.018 * lane;
  let x = -0.78 + lane * 0.195 + cos(orbit) * radius;
  let y = -0.48 + row * 0.18 + sin(orbit) * radius * 0.55;
  let scale = 0.7 + 0.08 * f32(instance_index % 5u);
  var out: VertexOut;
  out.position = vec4f(triangle[vertex_index] * scale + vec2f(x, y), 0.0, 1.0);
  out.color = vec4f(0.08 + lane * 0.055, 0.42 + row * 0.06, 0.95 - lane * 0.035, 0.92);
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let glow = vec3f(0.08, 0.18, 0.34);
  return vec4f(in.color.rgb + glow, in.color.a);
}
