import { createRequire } from "module";
const DISASSEMBLE_INPUT_OFFSET: number = 0;
const DISASSEMBLE_INPUT_BYTE_COUNT_OFFSET: number = 4;
const DISASSEMBLE_IS_HANGULS_OFFSET: number = 8;
const DISASSEMBLE_JAMOS_OFFSET: number = 12;
const DISASSEMBLE_JAMOS_COUNT_OFFSET: number = 16;
const DISASSEMBLE_JAMOS_BYTE_COUNT_OFFSET: number = 20;
const DISASSEMBLE_SYLLABLE_POSITIONS_OFFSET: number = 24;

const ASSEMBLE_INPUT_OFFET: number = 0;
const ASSEMBLE_INPUT_BYTE_COUNT_OFFSET: number = 4;
const ASSEMBLE_CHARACTERS_OFFSET: number = 8;
const ASSEMBLE_CHARACTERS_COUNT_OFFSET: number = 12;
const ASSEMBLE_CHARACTERS_BYTE_COUNT_OFFSET: number = 16;
const nullByte = 0x00;

enum SyllablePosition {
  CODA,
  NUCLEUS,
  ONSET,
  NOT_APPLICABLE,
}

type DisassembleResult = {
  input: string;
  is_hanguls: boolean[];
  text: string[];
  syllable_positions: SyllablePosition[];
};

type AssembleResult = {
  input: number;
  text: string;
};

const decodeString = (buffer, pointer, length) => {
  const slice = new Uint8Array(buffer, pointer, length);
  return new TextDecoder().decode(slice);
};

let importObject = {
  env: {
    jslog: function (x: number) {
      console.log(x);
    },
  },
};

class JamoParser {
  //private wasmModule: WebAssembly.Module | null = null;
  private wasmInstance: WebAssembly.Instance | null = null;
  private memory: WebAssembly.Memory | null = null;
  private _disassemble: CallableFunction | null = null;
  private _cleanup_disassemble: CallableFunction | null = null;
  private _assemble: CallableFunction | null = null;
  private _cleanup_assemble: CallableFunction | null = null;
  private _allocUint8: CallableFunction | null = null;
  //private wasmFilePath: string;
  private loaded: Boolean = false;

  constructor() {
    //this.wasmFilePath = Bun.file("./hama.wasm");
  }

  async load(): Promise<void> {
    try {
      let wasmBuffer;
      let wasmModule;

      const wasmURL = new URL(
        "../../zig-out/bin/hama-jamo.wasm",
        import.meta.url,
      );
      if (typeof window === "undefined") {
        // Node.js
        const require = createRequire(import.meta.url);
        const fs = require("fs");
        wasmBuffer = fs.readFileSync(wasmURL);
        wasmModule = await WebAssembly.instantiate(wasmBuffer, importObject);
      } else {
        // Browser
        const response = await fetch(wasmURL);
        wasmBuffer = await response.arrayBuffer();
        wasmModule = await WebAssembly.instantiateStreaming(
          wasmBuffer,
          importObject,
        );
      }
      //const wasmModule = await WebAssembly.instantiateStreaming(wasmBuffer, importObject);
      this.wasmInstance = wasmModule.instance;
      this._disassemble = this.wasmInstance.exports
        .disassemble as CallableFunction;
      this._assemble = this.wasmInstance.exports.assemble as CallableFunction;
      this._cleanup_disassemble = this.wasmInstance.exports
        .cleanup_disassemble as CallableFunction;
      this._cleanup_assemble = this.wasmInstance.exports
        .cleanup_assemble as CallableFunction;
      this._allocUint8 = this.wasmInstance.exports
        .allocUint8 as CallableFunction;
      this.memory = this.wasmInstance.exports.memory as WebAssembly.Memory;
      this.loaded = true;
    } catch (error) {
      console.error("Error loading WASM module:", error);
    }
  }

  disassemble(text: string): DisassembleResult {
    const [encoded, encoded_byte_length] = this.encodeString(text);

    if (!this._disassemble) {
      throw new Error("disassemble function is not available");
    }
    const pointer = this._disassemble(encoded, encoded_byte_length, true);
    const view = new DataView(this.memory.buffer);

    // Get original string.
    const input_address = view.getUint32(pointer, true);
    const input_byte_count = view.getUint32(
      pointer + DISASSEMBLE_INPUT_BYTE_COUNT_OFFSET,
      true,
    );
    const input = decodeString(
      this.memory.buffer,
      input_address,
      input_byte_count,
    );

    // Get jamo count.
    const jamos_count = view.getUint32(
      pointer + DISASSEMBLE_JAMOS_COUNT_OFFSET,
      true,
    );
    // Get is_hanguls.
    const is_hanguls_address = view.getUint32(
      pointer + DISASSEMBLE_IS_HANGULS_OFFSET,
      true,
    );
    const is_hanguls = new Uint8Array(
      this.memory.buffer,
      is_hanguls_address,
      jamos_count,
    );

    // Get jamos.
    const jamos_address = view.getUint32(
      pointer + DISASSEMBLE_JAMOS_OFFSET,
      true,
    );
    const jamos_byte_count = view.getUint32(
      pointer + DISASSEMBLE_JAMOS_BYTE_COUNT_OFFSET,
      true,
    );
    const jamos_str = decodeString(
      this.memory.buffer,
      jamos_address,
      jamos_byte_count,
    );
    // Get syllable positions.
    const syllable_positions_address = view.getUint32(
      pointer + DISASSEMBLE_SYLLABLE_POSITIONS_OFFSET,
      true,
    );
    const syllable_positions = new Uint8Array(
      this.memory.buffer,
      syllable_positions_address,
      jamos_count,
    );

    // Collect results.
    const jamos = [];
    // @TODO - do this whithout a loop.
    for (let i = 0; i < jamos_count; i++) {
      jamos.push(jamos_str[i]);
    }
    const result = {
      input: input,
      text: jamos,
      is_hanguls: is_hanguls,
      syllable_positions: syllable_positions,
    };
    this._cleanup_disassemble(pointer);
    return result;
  }

  assemble(text: string): AssembleResult {
    const [encoded, encoded_byte_length] = this.encodeString(text);

    if (!this._assemble) {
      throw new Error("assemble function is not available");
    }
    const pointer = this._assemble(encoded, encoded_byte_length);
    const view = new DataView(this.memory.buffer);
    const length = view.getUint32(pointer, true);

    // Get original string.
    const input_address = view.getUint32(pointer, true);
    const input_byte_count = view.getUint32(
      pointer + ASSEMBLE_INPUT_BYTE_COUNT_OFFSET,
      true,
    );
    const input = decodeString(
      this.memory.buffer,
      input_address,
      input_byte_count,
    );

    // Get assembled characters.
    const characters_address = view.getUint32(
      pointer + ASSEMBLE_CHARACTERS_OFFSET,
      true,
    );
    const characters_byte_count = view.getUint32(
      pointer + ASSEMBLE_CHARACTERS_BYTE_COUNT_OFFSET,
      true,
    );
    const characters = decodeString(
      this.memory.buffer,
      characters_address,
      characters_byte_count,
    );

    const result = {
      input: input,
      text: characters,
    };
    this._cleanup_assemble(pointer);
    return result;
  }

  callWasmFunction(funcName: string, ...args: any[]): any {
    if (!this.wasmInstance) {
      throw new Error("WASM module is not instantiated");
    }

    const func = this.wasmInstance.exports[funcName];
    if (typeof func !== "function") {
      throw new Error(`${funcName} is not a function in the WASM module`);
    }
    return func(...args);
  }
  encodeString(string: string): Uint8Array {
  if (this.loaded) {
    const buffer = new TextEncoder().encode(string);
    const pointer = this._allocUint8(buffer.length); // ask Zig to allocate memory
    const slice = new Uint8Array(this.memory.buffer, pointer, buffer.length);
    slice.set(buffer);
    return [pointer, buffer.length];
  }
  return [new Uint8Array([]), 0];
}

}

export { JamoParser };
