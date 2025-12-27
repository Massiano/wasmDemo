// Vertex data: x, y, r, g, b for 3 vertices
const vertices: StaticArray<f32> = [
   0.0,  0.5,  1.0, 0.0, 0.0,  // top - red
  -0.5, -0.5,  0.0, 1.0, 0.0,  // bottom left - green
   0.5, -0.5,  0.0, 0.0, 1.0   // bottom right - blue
];

export function getVerticesPtr(): usize {
  return changetype<usize>(vertices);
}

export function getVerticesLen(): i32 {
  return vertices.length;
}