struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  var points = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 0.72),
    vec2<f32>(-0.72, -0.48),
    vec2<f32>(0.72, -0.48)
  );
  let p = points[vertex_index];
  var out: VertexOut;
  out.position = vec4<f32>(p, 0.0, 1.0);
  out.color = vec4<f32>(0.08 + p.x * 0.2, 0.62, 1.0, 1.0);
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return in.color;
}
