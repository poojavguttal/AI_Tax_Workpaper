import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PACKET_PATH = fileURLToPath(new URL('../data/packet.json', import.meta.url));

export const readPacketText = () => readFileSync(PACKET_PATH, 'utf8');
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
