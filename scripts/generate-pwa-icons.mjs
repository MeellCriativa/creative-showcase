/**
 * Gera todos os ícones PWA a partir da arte da marca.
 *
 * Uso: node scripts/generate-pwa-icons.mjs
 *
 * A fonte (`assets/brand/vitrine-icon-source.png`) é preservada sem alterações.
 * São gerados ícones "any" (imagem inteira, fundo preenchido) e "maskable"
 * (arte centralizada em ~80% da área segura, fundo estendido), além do
 * apple-touch-icon e do favicon.ico multi-resolução.
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const root = process.cwd();
const sourcePath = path.join(root, "assets", "brand", "vitrine-icon-source.png");
const publicDir = path.join(root, "public");

const source = PNG.sync.read(fs.readFileSync(sourcePath));

/** Redimensionamento por média de área — evita aliasing ao reduzir. */
function resize(src, targetWidth, targetHeight) {
  const out = new PNG({ width: targetWidth, height: targetHeight });
  const xScale = src.width / targetWidth;
  const yScale = src.height / targetHeight;

  for (let y = 0; y < targetHeight; y += 1) {
    const y0 = y * yScale;
    const y1 = Math.min(src.height, (y + 1) * yScale);
    const syStart = Math.floor(y0);
    const syEnd = Math.min(src.height, Math.max(syStart + 1, Math.ceil(y1)));

    for (let x = 0; x < targetWidth; x += 1) {
      const x0 = x * xScale;
      const x1 = Math.min(src.width, (x + 1) * xScale);
      const sxStart = Math.floor(x0);
      const sxEnd = Math.min(src.width, Math.max(sxStart + 1, Math.ceil(x1)));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let total = 0;

      for (let sy = syStart; sy < syEnd; sy += 1) {
        const wy = Math.max(0, Math.min(sy + 1, y1) - Math.max(sy, y0));
        if (wy <= 0) continue;
        for (let sx = sxStart; sx < sxEnd; sx += 1) {
          const wx = Math.max(0, Math.min(sx + 1, x1) - Math.max(sx, x0));
          if (wx <= 0) continue;
          const weight = wy * wx;
          const i = (sy * src.width + sx) * 4;
          r += src.data[i] * weight;
          g += src.data[i + 1] * weight;
          b += src.data[i + 2] * weight;
          a += src.data[i + 3] * weight;
          total += weight;
        }
      }

      const o = (y * targetWidth + x) * 4;
      const alpha = total ? a / total : 255;
      // Fundo opaco da marca: nenhum ícone PWA deve ter borda transparente.
      out.data[o] = total ? Math.round(r / total) : 252;
      out.data[o + 1] = total ? Math.round(g / total) : 136;
      out.data[o + 2] = total ? Math.round(b / total) : 244;
      out.data[o + 3] = Math.round(alpha);
    }
  }
  return out;
}

/** Compõe o ícone maskable: fundo preenchido + arte central em 80%. */
function maskable(size) {
  const out = resize(source, size, size);
  const innerSize = Math.round(size * 0.8);
  const art = resize(source, innerSize, innerSize);
  const offset = Math.round((size - innerSize) / 2);

  for (let y = 0; y < innerSize; y += 1) {
    for (let x = 0; x < innerSize; x += 1) {
      const from = (y * innerSize + x) * 4;
      const to = ((y + offset) * size + (x + offset)) * 4;
      out.data[to] = art.data[from];
      out.data[to + 1] = art.data[from + 1];
      out.data[to + 2] = art.data[from + 2];
      out.data[to + 3] = 255;
    }
  }
  return out;
}

function writePng(name, image) {
  fs.writeFileSync(path.join(publicDir, name), PNG.sync.write(image, { colorType: 6 }));
  console.log(`  ${name} (${image.width}x${image.height})`);
}

/** ICO com entradas PNG (suportado pelo Windows Vista+ e navegadores). */
function writeIco(name, sizes) {
  const images = sizes.map((size) => ({
    size,
    buffer: PNG.sync.write(resize(source, size, size)),
  }));
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = header.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(image.size === 256 ? 0 : image.size, entry);
    header.writeUInt8(image.size === 256 ? 0 : image.size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.buffer.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.buffer.length;
  });

  fs.writeFileSync(
    path.join(publicDir, name),
    Buffer.concat([header, ...images.map((i) => i.buffer)]),
  );
  console.log(`  ${name} (${sizes.join(", ")}px)`);
}

console.log(`Fonte: ${sourcePath} (${source.width}x${source.height})`);
console.log("Gerando ícones any/apple:");
writePng("favicon-32.png", resize(source, 32, 32));
writePng("favicon.png", resize(source, 256, 256));
writePng("apple-touch-icon.png", resize(source, 180, 180));
writePng("icon-192.png", resize(source, 192, 192));
writePng("icon-512.png", resize(source, 512, 512));
writeIco("favicon.ico", [16, 32, 48]);

console.log("Gerando ícones maskable (área segura de 80%):");
writePng("icon-maskable-192.png", maskable(192));
writePng("icon-maskable-512.png", maskable(512));

console.log("notification-badge.png preservado (inalterado).");
