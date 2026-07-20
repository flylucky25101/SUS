import { GAME_CONFIG } from './config';
import { clamp } from './math';
import { EMPTY_COMMAND, type BufferedAction, type InputCommand, type InputMemory } from './types';

export interface InputEdges {
  pressed: Record<BufferedAction | 'pause', boolean>;
  released: Record<BufferedAction | 'pause', boolean>;
}

export function createInputMemory(): InputMemory {
  return {
    previous: { ...EMPTY_COMMAND },
    buffers: { normal: 0, special: 0, jump: 0, dodge: 0 },
    coyoteFrames: 0,
    chargeFrames: 0,
  };
}

export function sanitizeCommand(command: InputCommand): InputCommand {
  return {
    moveX: clamp(command.moveX, -1, 1),
    moveY: clamp(command.moveY, -1, 1),
    normal: Boolean(command.normal),
    special: Boolean(command.special),
    jump: Boolean(command.jump),
    dodge: Boolean(command.dodge),
    pause: Boolean(command.pause),
  };
}

function edge(current: boolean, previous: boolean): [boolean, boolean] {
  return [current && !previous, !current && previous];
}

export function advanceInputMemory(memory: InputMemory, rawCommand: InputCommand): InputEdges {
  const command = sanitizeCommand(rawCommand);
  const previous = memory.previous;
  const [normalPressed, normalReleased] = edge(command.normal, previous.normal);
  const [specialPressed, specialReleased] = edge(command.special, previous.special);
  const [jumpPressed, jumpReleased] = edge(command.jump, previous.jump);
  const [dodgePressed, dodgeReleased] = edge(command.dodge, previous.dodge);
  const [pausePressed, pauseReleased] = edge(command.pause, previous.pause);

  const actions: readonly BufferedAction[] = ['normal', 'special', 'jump', 'dodge'];
  for (const action of actions) memory.buffers[action] = Math.max(0, memory.buffers[action] - 1);
  if (normalPressed) memory.buffers.normal = GAME_CONFIG.inputBufferFrames;
  if (specialPressed) memory.buffers.special = GAME_CONFIG.inputBufferFrames;
  if (jumpPressed) memory.buffers.jump = GAME_CONFIG.jumpBufferFrames;
  if (dodgePressed) memory.buffers.dodge = GAME_CONFIG.inputBufferFrames;

  memory.previous = command;
  return {
    pressed: {
      normal: normalPressed,
      special: specialPressed,
      jump: jumpPressed,
      dodge: dodgePressed,
      pause: pausePressed,
    },
    released: {
      normal: normalReleased,
      special: specialReleased,
      jump: jumpReleased,
      dodge: dodgeReleased,
      pause: pauseReleased,
    },
  };
}

export function hasBuffered(memory: InputMemory, action: BufferedAction): boolean {
  return memory.buffers[action] > 0;
}

export function consumeBuffered(memory: InputMemory, action: BufferedAction): void {
  memory.buffers[action] = 0;
}
