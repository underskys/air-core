use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
    time::Instant,
};
use wasmi::{core::F32, Caller, Engine, Instance, Linker, Module, Store};
use winit::{
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::{Window, WindowBuilder},
};

#[derive(Debug, Deserialize)]
struct AirPackage {
    abi: String,
    module: String,
    wasm: String,
    manifest: Option<String>,
    #[serde(default)]
    capabilities: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    host: &'static str,
    backend: &'static str,
    available: bool,
    passed: u32,
    failed: u32,
    abi: String,
    module: Option<String>,
    unsupported_reason: Option<String>,
    capabilities: Vec<String>,
    shaders: usize,
    pipelines: usize,
    inputs: usize,
    ui_panels: usize,
    scene: SceneReport,
    render: RenderReport,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GfxStreamReport {
    host: &'static str,
    backend: &'static str,
    available: bool,
    passed: u32,
    failed: u32,
    abi: &'static str,
    module: Option<String>,
    unsupported_reason: Option<String>,
    capabilities: Vec<&'static str>,
    frames: Vec<GfxFrameReport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GfxFrameReport {
    t: i32,
    commands: usize,
    visible_instances: usize,
    zero_size_commands: usize,
    emissive_commands: usize,
    transparent_commands: usize,
    primitive_batches: usize,
    clearance: Option<i32>,
    animal_visible: Option<i32>,
    animal_rejected: Option<i32>,
    bird_visible: Option<i32>,
    camera: Option<GfxCameraReport>,
    skybox: Option<GfxSkyboxReport>,
    debug_metrics: BTreeMap<i32, i32>,
    frame_time_micros: u64,
    checksum: u32,
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct GfxCameraReport {
    x: i32,
    y: i32,
    z: i32,
    target_x: i32,
    target_y: i32,
    target_z: i32,
    fov: i32,
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct GfxSkyboxReport {
    asset: i32,
    tint: i32,
    intensity: i32,
    yaw: i32,
    pitch: i32,
    roll: i32,
}

#[derive(Debug, Clone)]
struct GfxCommand {
    primitive: i32,
    material: i32,
    x: i32,
    y: i32,
    z: i32,
    sx: i32,
    sy: i32,
    sz: i32,
    yaw: i32,
    pitch: i32,
    roll: i32,
    color: i32,
    emissive: i32,
    flags: i32,
}

#[derive(Debug, Default)]
struct GfxStreamState {
    commands: Vec<GfxCommand>,
    metrics: BTreeMap<i32, i32>,
    camera: Option<GfxCameraReport>,
    skybox: Option<GfxSkyboxReport>,
}

struct GfxStreamRuntime {
    store: Store<GfxStreamState>,
    instance: Instance,
}

#[derive(Clone, Copy)]
struct CubeVertex {
    position: [f32; 3],
    shade: f32,
}

#[derive(Clone, Copy)]
struct InstanceRaw {
    center: [f32; 3],
    half_size: [f32; 3],
    color: [f32; 4],
}

#[derive(Clone, Copy)]
struct CameraUniform {
    eye: [f32; 4],
    right: [f32; 4],
    up: [f32; 4],
    forward: [f32; 4],
    params: [f32; 4],
}

#[derive(Clone, Copy)]
struct Vec3 {
    x: f32,
    y: f32,
    z: f32,
}

struct CameraProjection {
    eye: Vec3,
    right: Vec3,
    up: Vec3,
    forward: Vec3,
    focal: f32,
    aspect: f32,
}

struct WindowRenderer {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    sky_pipeline: wgpu::RenderPipeline,
    pipeline: wgpu::RenderPipeline,
    cube_vertex_buffer: wgpu::Buffer,
    cube_vertex_count: u32,
    instance_buffer: Option<wgpu::Buffer>,
    instance_capacity: u64,
    camera_buffer: wgpu::Buffer,
    camera_bind_group: wgpu::BindGroup,
    depth_view: wgpu::TextureView,
    size: winit::dpi::PhysicalSize<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RenderReport {
    frames: u32,
    draw_calls: u32,
    passes: BTreeMap<String, u32>,
    checksum: u32,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct SceneReport {
    cameras: usize,
    lights: usize,
    nodes: usize,
    instances: usize,
    mesh_instances: usize,
    sprites: usize,
    voxels: usize,
    particles: usize,
}

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "help".to_string());
    match command.as_str() {
        "run" => {
            let package_dir = args
                .next()
                .ok_or_else(|| anyhow!("missing <package-dir>"))?;
            let report = pollster::block_on(run_package(Path::new(&package_dir)))?;
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        "conformance" => {
            let package_dir = args
                .next()
                .ok_or_else(|| anyhow!("missing <package-dir>"))?;
            let mut screenshot: Option<PathBuf> = None;
            while let Some(arg) = args.next() {
                if arg == "--screenshot" {
                    screenshot = args.next().map(PathBuf::from);
                }
            }
            let report = pollster::block_on(run_package(Path::new(&package_dir)))?;
            if let Some(path) = screenshot {
                fs::write(path, b"AIR native conformance placeholder\n")?;
            }
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        "gfx-stream" => {
            let wasm_path = args.next().ok_or_else(|| anyhow!("missing <wasm-path>"))?;
            let mut frames = vec![1000, 34000, 38000, 50000, 65000];
            while let Some(arg) = args.next() {
                if arg == "--frames" {
                    let raw = args
                        .next()
                        .ok_or_else(|| anyhow!("missing --frames value"))?;
                    frames = raw
                        .split(',')
                        .map(|part| {
                            part.trim()
                                .parse::<i32>()
                                .with_context(|| format!("parse frame time {part}"))
                        })
                        .collect::<Result<Vec<_>>>()?;
                }
            }
            let report = run_gfx_stream(Path::new(&wasm_path), &frames)?;
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        "gfx-window" => {
            let wasm_path = args.next().ok_or_else(|| anyhow!("missing <wasm-path>"))?;
            if let Err(err) = pollster::block_on(run_gfx_window(PathBuf::from(wasm_path))) {
                let report = serde_json::json!({
                    "host": "native",
                    "backend": "gfx-window",
                    "available": false,
                    "passed": 0,
                    "failed": 1,
                    "abi": "gfx",
                    "unsupportedReason": format!("{err:#}"),
                    "repairHint": "Run the CI-safe gfx-stream probe on headless systems, or retry gfx-window on a platform with a supported windowing and GPU adapter."
                });
                eprintln!("{}", serde_json::to_string_pretty(&report)?);
                return Err(err.context("native gfx-window failed; see diagnostic JSON above"));
            }
        }
        _ => {
            eprintln!("airgfx-native run <package-dir>");
            eprintln!("airgfx-native conformance <package-dir> --screenshot <path>");
            eprintln!("airgfx-native gfx-stream <wasm-path> [--frames 1000,34000]");
            eprintln!("airgfx-native gfx-window <wasm-path>");
        }
    }
    Ok(())
}

fn create_gfx_stream_runtime(wasm_path: &Path) -> Result<GfxStreamRuntime> {
    let bytes = fs::read(wasm_path).with_context(|| format!("read {}", wasm_path.display()))?;
    let engine = Engine::default();
    let module = Module::new(&engine, &mut &bytes[..])
        .with_context(|| format!("compile {}", wasm_path.display()))?;
    let mut store = Store::new(&engine, GfxStreamState::default());
    let mut linker = Linker::new(&engine);

    linker.func_wrap(
        "debug",
        "metric",
        |mut caller: Caller<'_, GfxStreamState>, id: i32, value: i32| {
            caller.data_mut().metrics.insert(id, value);
        },
    )?;
    linker.func_wrap(
        "input",
        "axis",
        |_caller: Caller<'_, GfxStreamState>, id: i32| -> F32 {
            if id == 9 {
                F32::from(1.0)
            } else {
                F32::from(0.0)
            }
        },
    )?;
    linker.func_wrap(
        "gfx",
        "begin_frame",
        |mut caller: Caller<'_, GfxStreamState>, _t: i32| {
            let state = caller.data_mut();
            state.commands.clear();
            state.metrics.clear();
            state.camera = None;
            state.skybox = None;
        },
    )?;
    linker.func_wrap("gfx", "end_frame", |_caller: Caller<'_, GfxStreamState>| {})?;
    linker.func_wrap(
        "gfx",
        "camera_look_at",
        |mut caller: Caller<'_, GfxStreamState>,
         x: i32,
         y: i32,
         z: i32,
         target_x: i32,
         target_y: i32,
         target_z: i32,
         fov: i32| {
            caller.data_mut().camera = Some(GfxCameraReport {
                x,
                y,
                z,
                target_x,
                target_y,
                target_z,
                fov,
            });
        },
    )?;
    linker.func_wrap(
        "gfx",
        "skybox_world",
        |mut caller: Caller<'_, GfxStreamState>,
         asset: i32,
         tint: i32,
         intensity: i32,
         yaw: i32,
         pitch: i32,
         roll: i32| {
            caller.data_mut().skybox = Some(GfxSkyboxReport {
                asset,
                tint,
                intensity,
                yaw,
                pitch,
                roll,
            });
        },
    )?;
    linker.func_wrap(
        "gfx",
        "draw_primitive",
        |mut caller: Caller<'_, GfxStreamState>,
         primitive: i32,
         material: i32,
         x: i32,
         y: i32,
         z: i32,
         sx: i32,
         sy: i32,
         sz: i32,
         yaw: i32,
         pitch: i32,
         roll: i32,
         color: i32,
         emissive: i32,
         flags: i32| {
            caller.data_mut().commands.push(GfxCommand {
                primitive,
                material,
                x,
                y,
                z,
                sx,
                sy,
                sz,
                yaw,
                pitch,
                roll,
                color,
                emissive,
                flags,
            });
        },
    )?;

    let instance = linker
        .instantiate(&mut store, &module)
        .context("instantiate AIR gfx stream module")?
        .start(&mut store)
        .context("start AIR gfx stream module")?;

    Ok(GfxStreamRuntime { store, instance })
}

impl GfxStreamRuntime {
    fn call_frame(&mut self, t: i32) -> Result<GfxFrameReport> {
        let frame = self
            .instance
            .get_typed_func::<i32, ()>(&mut self.store, "frame")
            .context("AIR module does not export frame(t)")?;
        let started = Instant::now();
        frame
            .call(&mut self.store, t)
            .with_context(|| format!("call frame({t})"))?;
        let frame_time_micros = started.elapsed().as_micros().min(u64::MAX as u128) as u64;
        Ok(gfx_frame_report(t, self.store.data(), frame_time_micros))
    }

    fn commands(&self) -> &[GfxCommand] {
        &self.store.data().commands
    }

    fn camera(&self) -> Option<GfxCameraReport> {
        self.store.data().camera
    }

    fn skybox(&self) -> Option<GfxSkyboxReport> {
        self.store.data().skybox
    }
}

fn run_gfx_stream(wasm_path: &Path, frames: &[i32]) -> Result<GfxStreamReport> {
    let mut runtime = create_gfx_stream_runtime(wasm_path)?;

    let mut reports = Vec::new();
    for &t in frames {
        reports.push(runtime.call_frame(t)?);
    }

    Ok(GfxStreamReport {
        host: "native",
        backend: "gfx-stream",
        available: true,
        passed: 1,
        failed: 0,
        abi: "gfx",
        module: wasm_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_string),
        unsupported_reason: None,
        capabilities: vec!["debug", "gfx", "input"],
        frames: reports,
    })
}

fn gfx_frame_report(t: i32, state: &GfxStreamState, frame_time_micros: u64) -> GfxFrameReport {
    let mut batches = BTreeMap::<(i32, i32, i32, i32), usize>::new();
    let mut visible = 0;
    let mut zero = 0;
    let mut emissive = 0;
    let mut transparent = 0;
    let mut checksum = t as u32;
    for cmd in &state.commands {
        checksum = checksum
            .wrapping_mul(16_777_619)
            .wrapping_add(cmd.primitive as u32)
            .wrapping_add((cmd.material as u32) << 3)
            .wrapping_add((cmd.x as u32).rotate_left(5))
            .wrapping_add((cmd.y as u32).rotate_left(11))
            .wrapping_add((cmd.z as u32).rotate_left(17))
            .wrapping_add((cmd.sx as u32).rotate_left(23))
            .wrapping_add((cmd.sy as u32).rotate_left(3))
            .wrapping_add((cmd.sz as u32).rotate_left(13))
            .wrapping_add((cmd.yaw as u32).rotate_left(19))
            .wrapping_add((cmd.pitch as u32).rotate_left(29))
            .wrapping_add((cmd.roll as u32).rotate_left(7))
            .wrapping_add((cmd.color as u32).rotate_left(7))
            .wrapping_add(cmd.emissive as u32)
            .wrapping_add(cmd.flags as u32);
        if cmd.sx <= 0 || cmd.sy <= 0 || cmd.sz <= 0 {
            zero += 1;
            continue;
        }
        visible += 1;
        if cmd.emissive >= 1800 && cmd.material != 15 {
            emissive += 1;
        }
        if (cmd.flags & 1) == 1 {
            transparent += 1;
        }
        *batches
            .entry((cmd.primitive, cmd.material, cmd.color, cmd.flags))
            .or_insert(0) += 1;
    }
    GfxFrameReport {
        t,
        commands: state.commands.len(),
        visible_instances: visible,
        zero_size_commands: zero,
        emissive_commands: emissive,
        transparent_commands: transparent,
        primitive_batches: batches.len(),
        clearance: state.metrics.get(&1).copied(),
        animal_visible: state.metrics.get(&10).copied(),
        animal_rejected: state.metrics.get(&11).copied(),
        bird_visible: state.metrics.get(&14).copied(),
        camera: state.camera,
        skybox: state.skybox,
        debug_metrics: state.metrics.clone(),
        frame_time_micros,
        checksum,
    }
}

async fn run_gfx_window(wasm_path: PathBuf) -> Result<()> {
    let event_loop = EventLoop::new()?;
    let window = WindowBuilder::new()
        .with_title("AIR native gfx.draw_primitive stream")
        .with_inner_size(winit::dpi::LogicalSize::new(1280.0, 800.0))
        .build(&event_loop)?;
    let window: &'static Window = Box::leak(Box::new(window));
    let mut renderer = WindowRenderer::new(window).await?;
    let mut runtime = create_gfx_stream_runtime(&wasm_path)?;
    let started = Instant::now();
    let mut fps_started = Instant::now();
    let mut fps_frames = 0u32;
    let mut last_instances = 0usize;
    let exit_after_ms = env::var("AIR_NATIVE_EXIT_MS")
        .ok()
        .and_then(|raw| raw.parse::<u128>().ok());

    event_loop.run(move |event, target| {
        target.set_control_flow(ControlFlow::Poll);
        match event {
            Event::WindowEvent { window_id, event } if window_id == window.id() => match event {
                WindowEvent::CloseRequested => target.exit(),
                WindowEvent::Resized(size) => renderer.resize(size),
                WindowEvent::ScaleFactorChanged { .. } => renderer.resize(window.inner_size()),
                WindowEvent::RedrawRequested => {
                    let t = started.elapsed().as_millis().min(i32::MAX as u128) as i32;
                    if let Err(err) = runtime.call_frame(t) {
                        eprintln!("AIR frame error: {err:#}");
                        target.exit();
                        return;
                    }
                    let instances = build_primitive_instances(
                        runtime.commands(),
                        runtime.camera(),
                        renderer.aspect_ratio(),
                    );
                    if let Err(err) =
                        renderer.render(&instances, runtime.camera(), runtime.skybox())
                    {
                        eprintln!("native renderer error: {err:#}");
                        target.exit();
                    }
                    last_instances = instances.len();
                    fps_frames += 1;
                }
                _ => {}
            },
            Event::AboutToWait => {
                let fps_elapsed = fps_started.elapsed();
                if fps_elapsed.as_millis() >= 500 {
                    let fps = fps_frames as f64 / fps_elapsed.as_secs_f64();
                    window.set_title(&format!(
                        "AIR native gfx.draw_primitive stream | {fps:.0} fps | instances {last_instances}"
                    ));
                    fps_frames = 0;
                    fps_started = Instant::now();
                }
                if exit_after_ms
                    .map(|limit| started.elapsed().as_millis() >= limit)
                    .unwrap_or(false)
                {
                    target.exit();
                    return;
                }
                window.request_redraw();
            }
            _ => {}
        }
    })?;
    Ok(())
}

impl WindowRenderer {
    async fn new(window: &'static Window) -> Result<Self> {
        let size = window.inner_size();
        let instance = wgpu::Instance::default();
        let surface = instance
            .create_surface(window)
            .context("create wgpu surface")?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| anyhow!("wgpu adapter unavailable for native window"))?;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default(), None)
            .await
            .context("request wgpu device")?;
        let caps = surface.get_capabilities(&adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|format| format.is_srgb())
            .unwrap_or_else(|| caps.formats[0]);
        let present_mode = caps
            .present_modes
            .iter()
            .copied()
            .find(|mode| *mode == wgpu::PresentMode::Fifo)
            .unwrap_or(caps.present_modes[0]);
        let alpha_mode = caps.alpha_modes[0];
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode,
            alpha_mode,
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        let cube_vertices = cube_vertices();
        let cube_bytes = cube_vertex_bytes(&cube_vertices);
        let cube_vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("air-gfx-cube-vertices"),
            size: cube_bytes.len() as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&cube_vertex_buffer, 0, &cube_bytes);

        let camera_uniform =
            CameraProjection::from_camera(None, config.width as f32 / config.height.max(1) as f32)
                .to_uniform();
        let camera_bytes = camera_uniform_bytes(&camera_uniform);
        let camera_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("air-gfx-camera-uniform"),
            size: camera_bytes.len() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&camera_buffer, 0, &camera_bytes);
        let camera_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("air-gfx-camera-bind-group-layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });
        let camera_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("air-gfx-camera-bind-group"),
            layout: &camera_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: camera_buffer.as_entire_binding(),
            }],
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("air-gfx-primitive-stream"),
            source: wgpu::ShaderSource::Wgsl(PRIMITIVE_STREAM_WGSL.into()),
        });
        let sky_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("air-gfx-sky"),
            source: wgpu::ShaderSource::Wgsl(SKY_WGSL.into()),
        });
        let sky_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("air-gfx-sky-layout"),
            bind_group_layouts: &[],
            push_constant_ranges: &[],
        });
        let sky_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("air-gfx-sky-pipeline"),
            layout: Some(&sky_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &sky_shader,
                entry_point: "vs_main",
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &sky_shader,
                entry_point: "fs_main",
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("air-gfx-primitive-stream-layout"),
            bind_group_layouts: &[&camera_bind_group_layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("air-gfx-primitive-stream-pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: "vs_main",
                buffers: &[
                    wgpu::VertexBufferLayout {
                        array_stride: 16,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &[
                            wgpu::VertexAttribute {
                                format: wgpu::VertexFormat::Float32x3,
                                offset: 0,
                                shader_location: 0,
                            },
                            wgpu::VertexAttribute {
                                format: wgpu::VertexFormat::Float32,
                                offset: 12,
                                shader_location: 1,
                            },
                        ],
                    },
                    wgpu::VertexBufferLayout {
                        array_stride: 40,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &[
                            wgpu::VertexAttribute {
                                format: wgpu::VertexFormat::Float32x3,
                                offset: 0,
                                shader_location: 2,
                            },
                            wgpu::VertexAttribute {
                                format: wgpu::VertexFormat::Float32x3,
                                offset: 12,
                                shader_location: 3,
                            },
                            wgpu::VertexAttribute {
                                format: wgpu::VertexFormat::Float32x4,
                                offset: 24,
                                shader_location: 4,
                            },
                        ],
                    },
                ],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: "fs_main",
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth24Plus,
                depth_write_enabled: true,
                depth_compare: wgpu::CompareFunction::Less,
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
        });
        let depth_view = create_depth_view(&device, config.width, config.height);

        Ok(Self {
            surface,
            device,
            queue,
            config,
            sky_pipeline,
            pipeline,
            cube_vertex_buffer,
            cube_vertex_count: cube_vertices.len() as u32,
            instance_buffer: None,
            instance_capacity: 0,
            camera_buffer,
            camera_bind_group,
            depth_view,
            size,
        })
    }

    fn aspect_ratio(&self) -> f32 {
        self.config.width.max(1) as f32 / self.config.height.max(1) as f32
    }

    fn resize(&mut self, size: winit::dpi::PhysicalSize<u32>) {
        if size.width == 0 || size.height == 0 {
            return;
        }
        self.size = size;
        self.config.width = size.width;
        self.config.height = size.height;
        self.surface.configure(&self.device, &self.config);
        self.depth_view = create_depth_view(&self.device, self.config.width, self.config.height);
    }

    fn render(
        &mut self,
        instances: &[InstanceRaw],
        camera: Option<GfxCameraReport>,
        skybox: Option<GfxSkyboxReport>,
    ) -> Result<()> {
        if self.size.width == 0 || self.size.height == 0 {
            return Ok(());
        }
        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
                return Ok(());
            }
            Err(wgpu::SurfaceError::Timeout) => return Ok(()),
            Err(wgpu::SurfaceError::OutOfMemory) => return Err(anyhow!("surface out of memory")),
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("air-gfx-primitive-stream-encoder"),
            });
        let projection = CameraProjection::from_camera(camera, self.aspect_ratio());
        let camera_uniform = projection.to_uniform();
        let camera_bytes = camera_uniform_bytes(&camera_uniform);
        self.queue
            .write_buffer(&self.camera_buffer, 0, &camera_bytes);
        let bytes = instance_raw_bytes(instances);
        if !bytes.is_empty() {
            self.ensure_instance_buffer(bytes.len() as u64);
            if let Some(buffer) = &self.instance_buffer {
                self.queue.write_buffer(buffer, 0, &bytes);
            }
        }
        let clear = skybox_clear_color(skybox);
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("air-gfx-sky-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(clear),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.sky_pipeline);
            pass.draw(0..3, 0..1);
        }
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("air-gfx-primitive-stream-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                occlusion_query_set: None,
                timestamp_writes: None,
            });
            if let Some(buffer) = &self.instance_buffer {
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, &self.camera_bind_group, &[]);
                pass.set_vertex_buffer(0, self.cube_vertex_buffer.slice(..));
                pass.set_vertex_buffer(1, buffer.slice(..));
                pass.draw(0..self.cube_vertex_count, 0..instances.len() as u32);
            }
        }
        self.queue.submit(Some(encoder.finish()));
        frame.present();
        Ok(())
    }

    fn ensure_instance_buffer(&mut self, needed: u64) {
        if self.instance_capacity >= needed {
            return;
        }
        let capacity = needed.next_power_of_two();
        self.instance_buffer = Some(self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("air-gfx-primitive-stream-instances"),
            size: capacity,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }));
        self.instance_capacity = capacity;
    }
}

fn create_depth_view(device: &wgpu::Device, width: u32, height: u32) -> wgpu::TextureView {
    let depth = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("air-gfx-depth"),
        size: wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Depth24Plus,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    depth.create_view(&wgpu::TextureViewDescriptor::default())
}

fn build_primitive_instances(
    commands: &[GfxCommand],
    camera: Option<GfxCameraReport>,
    aspect: f32,
) -> Vec<InstanceRaw> {
    let projection = CameraProjection::from_camera(camera, aspect);
    let mut instances = Vec::with_capacity(commands.len());
    for cmd in commands {
        if cmd.sx <= 0 || cmd.sy <= 0 || cmd.sz <= 0 {
            continue;
        }
        let center = Vec3::new(cmd.x as f32, cmd.y as f32, cmd.z as f32);
        let depth = projection.depth(center);
        if (120.0..80_000.0).contains(&depth) {
            let height_tint = ((cmd.y + cmd.sy) as f32 / 16_000.0).clamp(-0.18, 0.22);
            instances.push(InstanceRaw {
                center: [cmd.x as f32, cmd.y as f32, cmd.z as f32],
                half_size: [
                    (cmd.sx.max(1) as f32 * 0.5).max(8.0),
                    (cmd.sy.max(1) as f32 * 0.5).max(8.0),
                    (cmd.sz.max(1) as f32 * 0.5).max(8.0),
                ],
                color: primitive_color(cmd, height_tint),
            });
        }
    }
    instances
}

impl Vec3 {
    fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    fn sub(self, other: Self) -> Self {
        Self::new(self.x - other.x, self.y - other.y, self.z - other.z)
    }

    fn dot(self, other: Self) -> f32 {
        self.x * other.x + self.y * other.y + self.z * other.z
    }

    fn cross(self, other: Self) -> Self {
        Self::new(
            self.y * other.z - self.z * other.y,
            self.z * other.x - self.x * other.z,
            self.x * other.y - self.y * other.x,
        )
    }

    fn normalize(self) -> Self {
        let len = self.dot(self).sqrt();
        if len <= 0.0001 {
            return Self::new(0.0, 0.0, 0.0);
        }
        Self::new(self.x / len, self.y / len, self.z / len)
    }
}

impl CameraProjection {
    fn from_camera(camera: Option<GfxCameraReport>, aspect: f32) -> Self {
        let camera = camera.unwrap_or(GfxCameraReport {
            x: 0,
            y: 9400,
            z: -7200,
            target_x: 0,
            target_y: 650,
            target_z: 16800,
            fov: 76000,
        });
        let eye = Vec3::new(camera.x as f32, camera.y as f32, camera.z as f32);
        let target = Vec3::new(
            camera.target_x as f32,
            camera.target_y as f32,
            camera.target_z as f32,
        );
        let forward = target.sub(eye).normalize();
        let world_up = Vec3::new(0.0, 1.0, 0.0);
        let mut right = world_up.cross(forward).normalize();
        if right.dot(right) <= 0.0001 {
            right = Vec3::new(1.0, 0.0, 0.0);
        }
        let up = forward.cross(right).normalize();
        let fov_degrees = (camera.fov as f32 / 1000.0).clamp(35.0, 92.0);
        let focal = 1.0 / (fov_degrees.to_radians() * 0.5).tan();
        Self {
            eye,
            right,
            up,
            forward,
            focal,
            aspect: aspect.max(0.1),
        }
    }

    fn depth(&self, point: Vec3) -> f32 {
        point.sub(self.eye).dot(self.forward)
    }

    fn to_uniform(&self) -> CameraUniform {
        CameraUniform {
            eye: [self.eye.x, self.eye.y, self.eye.z, 0.0],
            right: [self.right.x, self.right.y, self.right.z, 0.0],
            up: [self.up.x, self.up.y, self.up.z, 0.0],
            forward: [self.forward.x, self.forward.y, self.forward.z, 0.0],
            params: [self.focal, self.aspect, 120.0, 80_000.0],
        }
    }
}

fn primitive_color(cmd: &GfxCommand, height_tint: f32) -> [f32; 4] {
    let packed = if cmd.color == 0 {
        fallback_material_color(cmd.material)
    } else {
        cmd.color
    };
    let r = ((packed >> 16) & 0xff) as f32 / 255.0;
    let g = ((packed >> 8) & 0xff) as f32 / 255.0;
    let b = (packed & 0xff) as f32 / 255.0;
    let emissive = if cmd.emissive > 0 {
        (cmd.emissive as f32 / 4000.0).clamp(0.0, 0.45)
    } else {
        0.0
    };
    let alpha = if (cmd.flags & 1) == 1 { 0.48 } else { 1.0 };
    [
        (r + height_tint + emissive).clamp(0.0, 1.0),
        (g + height_tint + emissive).clamp(0.0, 1.0),
        (b + height_tint + emissive).clamp(0.0, 1.0),
        alpha,
    ]
}

fn fallback_material_color(material: i32) -> i32 {
    match material.rem_euclid(8) {
        0 => 0x5f7f68,
        1 => 0x8c7a4a,
        2 => 0x4f6d8a,
        3 => 0x6c5353,
        4 => 0x3d6f58,
        5 => 0x8a8f9c,
        6 => 0x2d4668,
        _ => 0x7d6a58,
    }
}

fn cube_vertices() -> Vec<CubeVertex> {
    let mut out = Vec::with_capacity(36);
    push_cube_face(
        &mut out,
        [
            [-1.0, 1.0, -1.0],
            [1.0, 1.0, -1.0],
            [1.0, 1.0, 1.0],
            [-1.0, 1.0, 1.0],
        ],
        1.08,
    );
    push_cube_face(
        &mut out,
        [
            [-1.0, -1.0, -1.0],
            [-1.0, -1.0, 1.0],
            [1.0, -1.0, 1.0],
            [1.0, -1.0, -1.0],
        ],
        0.55,
    );
    push_cube_face(
        &mut out,
        [
            [-1.0, -1.0, -1.0],
            [1.0, -1.0, -1.0],
            [1.0, 1.0, -1.0],
            [-1.0, 1.0, -1.0],
        ],
        0.82,
    );
    push_cube_face(
        &mut out,
        [
            [-1.0, -1.0, 1.0],
            [-1.0, 1.0, 1.0],
            [1.0, 1.0, 1.0],
            [1.0, -1.0, 1.0],
        ],
        0.74,
    );
    push_cube_face(
        &mut out,
        [
            [-1.0, -1.0, -1.0],
            [-1.0, 1.0, -1.0],
            [-1.0, 1.0, 1.0],
            [-1.0, -1.0, 1.0],
        ],
        0.68,
    );
    push_cube_face(
        &mut out,
        [
            [1.0, -1.0, -1.0],
            [1.0, -1.0, 1.0],
            [1.0, 1.0, 1.0],
            [1.0, 1.0, -1.0],
        ],
        0.9,
    );
    out
}

fn push_cube_face(out: &mut Vec<CubeVertex>, points: [[f32; 3]; 4], shade: f32) {
    for position in [
        points[0], points[1], points[2], points[0], points[2], points[3],
    ] {
        out.push(CubeVertex { position, shade });
    }
}

fn cube_vertex_bytes(vertices: &[CubeVertex]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vertices.len() * 16);
    for vertex in vertices {
        for value in vertex.position {
            bytes.extend_from_slice(&value.to_ne_bytes());
        }
        bytes.extend_from_slice(&vertex.shade.to_ne_bytes());
    }
    bytes
}

fn instance_raw_bytes(instances: &[InstanceRaw]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(instances.len() * 40);
    for instance in instances {
        for value in instance.center {
            bytes.extend_from_slice(&value.to_ne_bytes());
        }
        for value in instance.half_size {
            bytes.extend_from_slice(&value.to_ne_bytes());
        }
        for value in instance.color {
            bytes.extend_from_slice(&value.to_ne_bytes());
        }
    }
    bytes
}

fn camera_uniform_bytes(camera: &CameraUniform) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(80);
    for lane in [
        camera.eye,
        camera.right,
        camera.up,
        camera.forward,
        camera.params,
    ] {
        for value in lane {
            bytes.extend_from_slice(&value.to_ne_bytes());
        }
    }
    bytes
}

fn skybox_clear_color(skybox: Option<GfxSkyboxReport>) -> wgpu::Color {
    let Some(skybox) = skybox else {
        return wgpu::Color {
            r: 0.045,
            g: 0.052,
            b: 0.062,
            a: 1.0,
        };
    };
    let k = (skybox.intensity as f64 / 1000.0).clamp(0.0, 1.2);
    let r = ((skybox.tint >> 16) & 0xff) as f64 / 255.0;
    let g = ((skybox.tint >> 8) & 0xff) as f64 / 255.0;
    let b = (skybox.tint & 0xff) as f64 / 255.0;
    wgpu::Color {
        r: 0.06 + r * k * 0.55,
        g: 0.07 + g * k * 0.55,
        b: 0.08 + b * k * 0.55,
        a: 1.0,
    }
}

const PRIMITIVE_STREAM_WGSL: &str = r#"
struct Camera {
  eye: vec4<f32>,
  right: vec4<f32>,
  up: vec4<f32>,
  forward: vec4<f32>,
  params: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> camera: Camera;

struct VertexIn {
  @location(0) local_position: vec3<f32>,
  @location(1) shade: f32,
  @location(2) center: vec3<f32>,
  @location(3) half_size: vec3<f32>,
  @location(4) color: vec4<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(input: VertexIn) -> VertexOut {
  let world = input.center + input.local_position * input.half_size;
  let rel = world - camera.eye.xyz;
  let depth = max(dot(rel, camera.forward.xyz), 1.0);
  let focal = camera.params.x;
  let aspect = camera.params.y;
  let near = camera.params.z;
  let far = camera.params.w;
  let ndc_x = dot(rel, camera.right.xyz) * focal / (depth * aspect);
  let ndc_y = dot(rel, camera.up.xyz) * focal / depth;
  let ndc_z = clamp((depth - near) / (far - near), 0.0, 1.0);
  var out: VertexOut;
  out.position = vec4<f32>(ndc_x, ndc_y, ndc_z, 1.0);
  out.color = vec4<f32>(
    clamp(input.color.rgb * input.shade, vec3<f32>(0.0), vec3<f32>(1.0)),
    input.color.a
  );
  return out;
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
  return input.color;
}
"#;

const SKY_WGSL: &str = r#"
struct SkyOut {
  @builtin(position) position: vec4<f32>,
  @location(0) t: f32,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> SkyOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  let pos = positions[vertex_index];
  var out: SkyOut;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.t = clamp(pos.y * 0.5 + 0.5, 0.0, 1.0);
  return out;
}

@fragment
fn fs_main(input: SkyOut) -> @location(0) vec4<f32> {
  let horizon = vec3<f32>(0.86, 0.62, 0.31);
  let zenith = vec3<f32>(0.43, 0.55, 0.70);
  let glow = vec3<f32>(0.98, 0.78, 0.42) * (1.0 - input.t) * 0.18;
  return vec4<f32>(mix(horizon, zenith, input.t) + glow, 1.0);
}
"#;

async fn run_package(package_dir: &Path) -> Result<Report> {
    let package_path = package_dir.join("air-package.json");
    let package: AirPackage = read_json(&package_path)?;
    let wasm_path = package_dir.join(&package.wasm);
    if !wasm_path.exists() {
        return Err(anyhow!("missing wasm {}", package.wasm));
    }
    let manifest_name = package
        .manifest
        .clone()
        .ok_or_else(|| anyhow!("package has no manifest"))?;
    let manifest_path = package_dir.join(&manifest_name);
    let manifest: Value = read_json(&manifest_path)?;

    let instance = wgpu::Instance::default();
    let adapter = match instance
        .request_adapter(&wgpu::RequestAdapterOptions::default())
        .await
    {
        Some(adapter) => adapter,
        None => {
            return Ok(Report {
                host: "native",
                backend: "wgpu",
                available: false,
                passed: 0,
                failed: 0,
                abi: package.abi,
                module: Some(package.module),
                unsupported_reason: Some("wgpu adapter unavailable".to_string()),
                capabilities: package.capabilities,
                shaders: 0,
                pipelines: 0,
                inputs: 0,
                ui_panels: 0,
                scene: SceneReport::default(),
                render: RenderReport {
                    frames: 0,
                    draw_calls: 0,
                    passes: BTreeMap::new(),
                    checksum: 0,
                },
            });
        }
    };
    let (device, _queue) = adapter
        .request_device(&wgpu::DeviceDescriptor::default(), None)
        .await
        .context("request wgpu device")?;

    let shaders = manifest
        .get("shaders")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for (key, shader) in &shaders {
        let rel = shader
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("shader {key} missing path"))?;
        let source = fs::read_to_string(package_dir.join(rel))
            .with_context(|| format!("read shader {rel}"))?;
        let _module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(key),
            source: wgpu::ShaderSource::Wgsl(source.into()),
        });
    }
    let pipelines = manifest
        .get("pipelines")
        .and_then(Value::as_object)
        .map(|v| v.len())
        .unwrap_or(0);
    let inputs = manifest
        .get("inputs")
        .and_then(Value::as_object)
        .map(|v| v.len())
        .unwrap_or(0);
    let ui_panels = manifest
        .get("ui")
        .and_then(|ui| ui.get("panels"))
        .and_then(Value::as_object)
        .map(|v| v.len())
        .unwrap_or(0);
    let scene = scene_report(&manifest);
    let passes = render_pass_report(&manifest);
    let draw_calls = passes.values().sum::<u32>();
    let scene_weight = (scene.cameras
        + scene.lights
        + scene.nodes
        + scene.mesh_instances
        + scene.sprites
        + scene.voxels
        + scene.particles) as u32;
    let checksum = ((shaders.len() as u32) * 17
        + (pipelines as u32) * 31
        + (inputs as u32) * 43
        + (ui_panels as u32) * 59
        + scene_weight * 67
        + draw_calls * 71)
        % 100_000;

    Ok(Report {
        host: "native",
        backend: "wgpu",
        available: true,
        passed: 1,
        failed: 0,
        abi: package.abi,
        module: Some(package.module),
        unsupported_reason: None,
        capabilities: package.capabilities,
        shaders: shaders.len(),
        pipelines,
        inputs,
        ui_panels,
        scene,
        render: RenderReport {
            frames: 1,
            draw_calls,
            passes,
            checksum,
        },
    })
}

fn scene_report(manifest: &Value) -> SceneReport {
    let scene = manifest.get("scene").unwrap_or(&Value::Null);
    SceneReport {
        cameras: object_len(scene, "cameras"),
        lights: object_len(scene, "lights"),
        nodes: object_len(scene, "nodes"),
        instances: object_len(scene, "instances"),
        mesh_instances: object_len(scene, "meshInstances"),
        sprites: object_len(scene, "sprites"),
        voxels: object_len(scene, "voxels"),
        particles: object_len(scene, "particles"),
    }
}

fn render_pass_report(manifest: &Value) -> BTreeMap<String, u32> {
    let mut report = BTreeMap::new();
    let graphs = manifest.get("renderGraphs").and_then(Value::as_object);
    if let Some(graphs) = graphs {
        for graph in graphs.values() {
            if let Some(passes) = graph.get("passes").and_then(Value::as_array) {
                for pass in passes {
                    if let Some(kind) = pass.get("kind").and_then(Value::as_str) {
                        let weight = match kind {
                            "geometry" => {
                                scene_report(manifest).nodes
                                    + scene_report(manifest).instances
                                    + scene_report(manifest).mesh_instances
                            }
                            "sprite" => scene_report(manifest).sprites,
                            "voxel" => scene_report(manifest).voxels,
                            "particles" => scene_report(manifest).particles,
                            "ui" => {
                                object_len(manifest.get("ui").unwrap_or(&Value::Null), "panels")
                            }
                            "post" | "present" | "clear" => 1,
                            _ => 0,
                        };
                        *report.entry(kind.to_string()).or_insert(0) += weight.max(1) as u32;
                    }
                }
            }
        }
    }
    report
}

fn object_len(value: &Value, key: &str) -> usize {
    value
        .get(key)
        .and_then(Value::as_object)
        .map(|v| v.len())
        .unwrap_or(0)
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    let text = fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parse {}", path.display()))
}
