import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../src/core/config';
import { advanceInputMemory, consumeBuffered, createInputMemory, hasBuffered, sanitizeCommand } from '../../src/core/input';
import { EMPTY_COMMAND } from '../../src/core/types';

describe('input buffering', () => {
  it('records a fresh action edge for the configured window', () => {
    const memory = createInputMemory();
    const edges = advanceInputMemory(memory, { ...EMPTY_COMMAND, normal: true });
    expect(edges.pressed.normal).toBe(true);
    expect(memory.buffers.normal).toBe(GAME_CONFIG.inputBufferFrames);
  });

  it('does not retrigger while a button remains held', () => {
    const memory = createInputMemory();
    advanceInputMemory(memory, { ...EMPTY_COMMAND, jump: true });
    const edges = advanceInputMemory(memory, { ...EMPTY_COMMAND, jump: true });
    expect(edges.pressed.jump).toBe(false);
    expect(memory.buffers.jump).toBe(GAME_CONFIG.jumpBufferFrames - 1);
  });

  it('reports release edges', () => {
    const memory = createInputMemory();
    advanceInputMemory(memory, { ...EMPTY_COMMAND, normal: true });
    expect(advanceInputMemory(memory, { ...EMPTY_COMMAND }).released.normal).toBe(true);
  });

  it('consumes buffered actions explicitly', () => {
    const memory = createInputMemory();
    advanceInputMemory(memory, { ...EMPTY_COMMAND, dodge: true });
    expect(hasBuffered(memory, 'dodge')).toBe(true);
    consumeBuffered(memory, 'dodge');
    expect(hasBuffered(memory, 'dodge')).toBe(false);
  });

  it('sanitizes analog and non-finite values', () => {
    const command = sanitizeCommand({ ...EMPTY_COMMAND, moveX: 8, moveY: Number.NaN });
    expect(command.moveX).toBe(1);
    expect(command.moveY).toBe(-1);
  });
});
