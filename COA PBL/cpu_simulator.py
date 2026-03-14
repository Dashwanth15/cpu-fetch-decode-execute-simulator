"""
================================================================================
  COA END-SEMESTER PROJECT
  Title : Design and Simulation of the CPU Instruction Fetch–Decode–Execute Cycle
  Model : Von Neumann Architecture  |  Style : Mano / Stallings RTL Model
  Author: [Your Name]
  Date  : 2026-03-01
================================================================================

ARCHITECTURE OVERVIEW
---------------------
  Registers  : PC (12-bit), IR (16-bit), AR (12-bit), DR (16-bit),
                AC (16-bit), TR (16-bit), Z (1-bit flag)
  Memory     : 256 × 16-bit words
  ALU        : ADD, SUB, CLEAR
  Control    : Explicit timing states (T0 … Tn), control-signal generation

INSTRUCTION FORMAT (16 bits)
------------------------------
  | I (1) | Opcode (3) | Address (12) |
  Bit 15  : Indirect flag (I)
  Bits 14–12 : Opcode
  Bits 11– 0 : Address field

OPCODE TABLE
------------
  000 → LOAD             010 → ADD        100 → BRANCH
  001 → STORE            011 → SUB        101 → BRANCH_IF_ZERO
  110 → CLEAR            111 → HALT
"""

import sys
# Force UTF-8 output on Windows consoles to prevent UnicodeEncodeError
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ──────────────────────────────────────────────────────────────────────────────
# MASKS AND CONSTANTS
# ──────────────────────────────────────────────────────────────────────────────

WORD_BITS     = 16
ADDR_BITS     = 12
WORD_MASK     = (1 << WORD_BITS) - 1          # 0xFFFF
ADDR_MASK     = (1 << ADDR_BITS) - 1          # 0x0FFF
OPCODE_SHIFT  = 12
OPCODE_MASK   = 0b111
INDIRECT_BIT  = 15

# Opcode definitions (3-bit)
OP_LOAD           = 0b000
OP_STORE          = 0b001
OP_ADD            = 0b010
OP_SUB            = 0b011
OP_BRANCH         = 0b100
OP_BRANCH_IF_ZERO = 0b101
OP_CLEAR          = 0b110
OP_HALT           = 0b111

OPCODE_NAMES = {
    OP_LOAD           : "LOAD",
    OP_STORE          : "STORE",
    OP_ADD            : "ADD",
    OP_SUB            : "SUB",
    OP_BRANCH         : "BRANCH",
    OP_BRANCH_IF_ZERO : "BRANCH_IF_ZERO",
    OP_CLEAR          : "CLEAR",
    OP_HALT           : "HALT",
}

SEPARATOR = "=" * 72


# ──────────────────────────────────────────────────────────────────────────────
# MEMORY CLASS
# Hardware model: 256 × 16-bit ROM/RAM
# ──────────────────────────────────────────────────────────────────────────────
class Memory:
    """
    Simulates main memory (MAR → MDR bus model).
    Capacity : 256 words, each 16 bits wide.
    Access    : read(address) and write(address, data).
    """

    SIZE = 256  # Number of addressable locations

    def __init__(self):
        # All locations initialised to 0x0000 (power-on reset)
        self._mem = [0x0000] * Memory.SIZE

    # ── Public interface ──────────────────────────────────────────────────────

    def read(self, address: int) -> int:
        """Read a 16-bit word from address. Raises on out-of-range."""
        self._check_address(address)
        return self._mem[address] & WORD_MASK

    def write(self, address: int, data: int) -> None:
        """Write a 16-bit word to address. Raises on out-of-range."""
        self._check_address(address)
        self._mem[address] = data & WORD_MASK

    def load_program(self, program: dict) -> None:
        """
        Bulk-load a program/data dictionary {address: value}.
        All values are masked to 16 bits before storage.
        """
        for addr, val in program.items():
            self.write(addr, val)

    def dump(self, start: int = 0, end: int = 32) -> str:
        """Return a human-readable hex dump of memory locations [start, end)."""
        lines = ["Memory Dump:"]
        for i in range(start, min(end, Memory.SIZE)):
            lines.append(f"  M[{i:03X}] = {self._mem[i]:04X}  ({self._mem[i]:016b})")
        return "\n".join(lines)

    # ── Private helpers ───────────────────────────────────────────────────────

    def _check_address(self, address: int) -> None:
        if not (0 <= address < Memory.SIZE):
            raise IndexError(f"Memory address {address:#05X} is out of range "
                             f"(valid: 0x000 – {Memory.SIZE - 1:#05X})")


# ──────────────────────────────────────────────────────────────────────────────
# ALU CLASS
# Hardware model: combinational logic unit
# ──────────────────────────────────────────────────────────────────────────────
class ALU:
    """
    Arithmetic Logic Unit.
    Receives two 16-bit operands, performs one operation, and produces:
      - result (16-bit, masked)
      - zero_flag  (1 if result == 0, else 0)

    RTL notation:
        ADD  : result ← AC + DR
        SUB  : result ← AC – DR  (2's complement)
        CLEAR: result ← 0000H
    """

    def execute(self, operation: str, ac: int, dr: int) -> tuple[int, int]:
        """
        Parameters
        ----------
        operation : 'ADD' | 'SUB' | 'CLEAR'
        ac        : current Accumulator value
        dr        : current Data Register value

        Returns
        -------
        (result, zero_flag)
        """
        if operation == "ADD":
            result = (ac + dr) & WORD_MASK
        elif operation == "SUB":
            # Two's complement subtraction, kept within 16-bit word
            result = (ac - dr) & WORD_MASK
        elif operation == "CLEAR":
            result = 0x0000
        else:
            raise ValueError(f"ALU: Unknown operation '{operation}'")

        zero_flag = 1 if result == 0 else 0
        return result, zero_flag


# ──────────────────────────────────────────────────────────────────────────────
# CONTROL UNIT CLASS
# Hardware model: hardwired control (timing + signal generation)
# ──────────────────────────────────────────────────────────────────────────────
class ControlUnit:
    """
    Hardwired Control Unit.

    Responsibilities
    ----------------
    1. Maintain the global clock counter and T-state counter.
    2. Determine the current phase (FETCH / DECODE / EXECUTE).
    3. Issue the exact control signals for each T-state.
    4. Sequence RTL micro-operations for every opcode.

    Control signals generated (examples):
        PC_out  – PC drives the address bus
        AR_in   – AR latches from the address bus
        MEM_read – Memory outputs data onto the data bus
        MEM_write– Memory writes data from the data bus
        IR_in   – IR latches from the data bus
        PC_inc  – PC ← PC + 1
        DR_in   – DR latches from the data bus
        AC_in   – AC latches the ALU result
        ALU_add – ALU performs addition
        ALU_sub – ALU performs subtraction
        ALU_clr – ALU clears (outputs 0)
        PC_load – PC ← AR  (branch)
        Z_set   – Z flag is updated
    """

    def __init__(self):
        self.clock_cycle       = 0   # Global clock pulse counter
        self.instruction_count = 0   # Number of instructions retired
        self.t_state           = 0   # Current T-state within an instruction cycle
        self.phase             = "FETCH"

    def next_clock(self) -> None:
        """Advance clock by one pulse and increment T-state."""
        self.clock_cycle += 1
        self.t_state     += 1

    def reset_t_state(self) -> None:
        """Reset T-state counter at the start of each instruction cycle."""
        self.t_state     = 0
        self.phase       = "FETCH"

    def retire_instruction(self) -> None:
        self.instruction_count += 1

    # ── Signal helpers ────────────────────────────────────────────────────────

    def fetch_signals(self, t: int, indirect: bool = False) -> list[str]:
        """Return control signals for fetch / decode steps."""
        if t == 0:
            return ["PC_out", "AR_in"]
        elif t == 1:
            return ["MEM_read", "IR_in", "PC_inc"]
        elif t == 2:
            return ["IR_out(addr)", "AR_in", "IR_decode"]
        elif t == 3 and indirect:
            return ["MEM_read", "AR_in"]          # AR ← M[AR]
        return []

    def execute_signals(self, opcode: int, step: int, z_flag: int = 0) -> list[str]:
        """Return control signals for each execute T-state of a given opcode."""
        table = {
            OP_LOAD  : [
                ["MEM_read", "DR_in"],            # DR ← M[AR]
                ["DR_out", "AC_in"],              # AC ← DR
            ],
            OP_STORE : [
                ["AC_out", "MEM_write"],          # M[AR] ← AC
            ],
            OP_ADD   : [
                ["MEM_read", "DR_in"],            # DR ← M[AR]
                ["ALU_add", "AC_in", "Z_set"],    # AC ← AC + DR
            ],
            OP_SUB   : [
                ["MEM_read", "DR_in"],            # DR ← M[AR]
                ["ALU_sub", "AC_in", "Z_set"],    # AC ← AC – DR
            ],
            OP_BRANCH : [
                ["AR_out", "PC_load"],            # PC ← AR
            ],
            OP_BRANCH_IF_ZERO : [
                ["AR_out", "PC_load"] if z_flag else ["NOP"],
            ],
            OP_CLEAR : [
                ["ALU_clr", "AC_in", "Z_set"],   # AC ← 0
            ],
            OP_HALT  : [
                ["HALT"],
            ],
        }
        signals = table.get(opcode, [[]])
        if step < len(signals):
            return signals[step]
        return []


# ──────────────────────────────────────────────────────────────────────────────
# CPU CLASS
# Hardware model: Von Neumann datapath + control unit integration
# ──────────────────────────────────────────────────────────────────────────────
class CPU:
    """
    Central Processing Unit.

    Register File
    -------------
    PC  (12-bit) : Program Counter
    IR  (16-bit) : Instruction Register
    AR  (12-bit) : Address Register (MAR)
    DR  (16-bit) : Data Register    (MDR)
    AC  (16-bit) : Accumulator
    TR  (16-bit) : Temporary Register
    Z   (1-bit)  : Zero Flag

    Instruction Cycle Phases
    ------------------------
    FETCH   → T0, T1, T2
    DECODE  → (built into T2; indirect adds T3)
    EXECUTE → T3/T4 … (opcode-dependent)
    """

    def __init__(self, memory: Memory):
        # ── Hardware registers ────────────────────────────────────────────────
        self.PC  = 0x000   # 12-bit Program Counter
        self.IR  = 0x0000  # 16-bit Instruction Register
        self.AR  = 0x000   # 12-bit Address Register
        self.DR  = 0x0000  # 16-bit Data Register
        self.AC  = 0x0000  # 16-bit Accumulator
        self.TR  = 0x0000  # 16-bit Temporary Register
        self.Z   = 0       # 1-bit Zero Flag

        # ── Subcomponents ─────────────────────────────────────────────────────
        self.memory  = memory
        self.alu     = ALU()
        self.cu      = ControlUnit()

        # ── Decoded fields (set at T2) ────────────────────────────────────────
        self._indirect = False
        self._opcode   = 0
        self._address  = 0

        # ── Execution log ─────────────────────────────────────────────────────
        self._halted = False
        self._log    = []        # List of formatted trace strings

    # ── Property helpers ──────────────────────────────────────────────────────

    @property
    def halted(self) -> bool:
        return self._halted

    # ── Main execution entry point ────────────────────────────────────────────

    def run(self, max_cycles: int = 500) -> None:
        """
        Run the CPU until HALT or max_cycles is reached.
        Each call to _tick() represents one clock pulse / micro-operation.
        """
        print(SEPARATOR)
        print("  CPU SIMULATION START")
        print(f"  Von Neumann  |  16-bit ISA  |  256-word Memory")
        print(SEPARATOR)
        print(self.memory.dump(0, 30))
        print(SEPARATOR)

        while not self._halted and self.cu.clock_cycle < max_cycles:
            self._execute_one_instruction()

        print(SEPARATOR)
        print("  SIMULATION COMPLETE")
        print(f"  Total Clock Cycles       : {self.cu.clock_cycle}")
        print(f"  Total Instructions Retired: {self.cu.instruction_count}")
        print(f"  Final Accumulator (AC)   : {self.AC:04X}h  ({self.AC})")
        print(f"  Zero Flag (Z)            : {self.Z}")
        print(SEPARATOR)
        if self._halted:
            print("  CPU halted normally (HALT instruction executed).")
        else:
            print("  WARNING: Max cycle limit reached before HALT.")
        print(SEPARATOR)

    # ── Instruction cycle ─────────────────────────────────────────────────────

    def _execute_one_instruction(self) -> None:
        """
        Complete one full instruction cycle:
            Fetch (T0–T2)  →  [Indirect fetch T3]  →  Execute (T3/T4 …)
        """
        self.cu.reset_t_state()

        print(f"\n{'─' * 72}")
        print(f"  INSTRUCTION CYCLE #{self.cu.instruction_count + 1:03d}   "
              f"(starting at PC = {self.PC:03X}h)")
        print(f"{'─' * 72}")

        # ── FETCH phase ───────────────────────────────────────────────────────
        self._fetch_t0()
        self._fetch_t1()
        self._fetch_t2()

        # ── INDIRECT address resolution ────────────────────────────────────
        if self._indirect:
            self._indirect_t3()

        # ── EXECUTE phase ─────────────────────────────────────────────────────
        self._execute_phase()

        self.cu.retire_instruction()

    # ──────────────────────────────────────────────────────────────────────────
    # FETCH MICRO-OPERATIONS  (per clock pulse)
    # ──────────────────────────────────────────────────────────────────────────

    def _fetch_t0(self) -> None:
        """
        T0 : AR ← PC
        RTL: Address Register is loaded with the current Program Counter.
             The PC drives the address bus; AR latches the value.
        """
        self.cu.next_clock()
        self.cu.phase = "FETCH"
        self.AR = self.PC & ADDR_MASK                # RTL: AR ← PC

        signals = self.cu.fetch_signals(0)
        self._print_cycle(
            phase   = "FETCH",
            t_label = "T0",
            rtl     = "AR ← PC",
            signals = signals,
        )

    def _fetch_t1(self) -> None:
        """
        T1 : IR ← M[AR],  PC ← PC + 1
        RTL: Memory outputs the instruction word onto the data bus;
             IR latches it.  PC is simultaneously incremented.
        """
        self.cu.next_clock()
        self.IR = self.memory.read(self.AR) & WORD_MASK  # RTL: IR ← M[AR]
        self.PC = (self.PC + 1) & ADDR_MASK              # RTL: PC ← PC + 1

        signals = self.cu.fetch_signals(1)
        self._print_cycle(
            phase   = "FETCH",
            t_label = "T1",
            rtl     = "IR ← M[AR],  PC ← PC + 1",
            signals = signals,
        )

    def _fetch_t2(self) -> None:
        """
        T2 : Decode IR  →  extract I, opcode, address
             AR ← IR[11:0]  (address field)
        RTL: Control unit decodes the opcode field.
             AR is updated with the address field of the instruction.
        """
        self.cu.next_clock()
        self.cu.phase = "DECODE"

        # ── Bit-level instruction decode (hardware barrel-shifter / mask) ──
        self._indirect = bool((self.IR >> INDIRECT_BIT) & 1)          # Bit 15
        self._opcode   = (self.IR >> OPCODE_SHIFT) & OPCODE_MASK       # Bits 14–12
        self._address  = self.IR & ADDR_MASK                           # Bits 11– 0

        self.AR = self._address                                        # RTL: AR ← IR[11:0]

        signals = self.cu.fetch_signals(2)
        self._print_cycle(
            phase   = "DECODE",
            t_label = "T2",
            rtl     = (f"Decode: I={int(self._indirect)}, "
                       f"OP={self._opcode:03b} ({OPCODE_NAMES.get(self._opcode,'???')}), "
                       f"ADDR={self._address:03X}h  |  AR ← IR[11:0]"),
            signals = signals,
        )

    def _indirect_t3(self) -> None:
        """
        T3 (INDIRECT) : AR ← M[AR]
        RTL: For indirect addressing, an extra memory read fetches the
             effective address.  AR is replaced with M[AR].
        """
        self.cu.next_clock()
        self.cu.phase = "DECODE (Indirect)"
        self.AR = self.memory.read(self.AR) & ADDR_MASK   # RTL: AR ← M[AR]

        signals = self.cu.fetch_signals(3, indirect=True)
        self._print_cycle(
            phase   = "DECODE (Indirect)",
            t_label = "T3",
            rtl     = "AR ← M[AR]   (indirect address resolution)",
            signals = signals,
        )

    # ──────────────────────────────────────────────────────────────────────────
    # EXECUTE MICRO-OPERATIONS  (opcode-dispatched)
    # ──────────────────────────────────────────────────────────────────────────

    def _execute_phase(self) -> None:
        """Dispatch to the correct execute sequence based on decoded opcode."""
        self.cu.phase = "EXECUTE"
        dispatch = {
            OP_LOAD           : self._exec_load,
            OP_STORE          : self._exec_store,
            OP_ADD            : self._exec_add,
            OP_SUB            : self._exec_sub,
            OP_BRANCH         : self._exec_branch,
            OP_BRANCH_IF_ZERO : self._exec_branch_if_zero,
            OP_CLEAR          : self._exec_clear,
            OP_HALT           : self._exec_halt,
        }
        handler = dispatch.get(self._opcode)
        if handler is None:
            raise RuntimeError(f"Unknown opcode: {self._opcode:03b}")
        handler()

    # ── LOAD ──────────────────────────────────────────────────────────────────
    def _exec_load(self) -> None:
        """
        LOAD:  AC ← M[AR]
        T3: DR ← M[AR]   — memory read, data bus → DR
        T4: AC ← DR      — DR drives accumulator input
        """
        # T3: DR ← M[AR]
        self.cu.next_clock()
        self.DR = self.memory.read(self.AR) & WORD_MASK
        self._print_cycle("EXECUTE", "T3", "DR ← M[AR]",
                          self.cu.execute_signals(OP_LOAD, 0))

        # T4: AC ← DR
        self.cu.next_clock()
        self.AC = self.DR & WORD_MASK
        self._print_cycle("EXECUTE", "T4", "AC ← DR",
                          self.cu.execute_signals(OP_LOAD, 1))

    # ── STORE ─────────────────────────────────────────────────────────────────
    def _exec_store(self) -> None:
        """
        STORE: M[AR] ← AC
        T3: M[AR] ← AC  — AC drives data bus, memory latches
        """
        self.cu.next_clock()
        self.memory.write(self.AR, self.AC)
        self._print_cycle("EXECUTE", "T3", "M[AR] ← AC",
                          self.cu.execute_signals(OP_STORE, 0))

    # ── ADD ───────────────────────────────────────────────────────────────────
    def _exec_add(self) -> None:
        """
        ADD: AC ← AC + M[AR]
        T3: DR ← M[AR]
        T4: AC ← AC + DR,  Z ← (AC == 0)
        """
        # T3
        self.cu.next_clock()
        self.DR = self.memory.read(self.AR) & WORD_MASK
        self._print_cycle("EXECUTE", "T3", "DR ← M[AR]",
                          self.cu.execute_signals(OP_ADD, 0))

        # T4
        self.cu.next_clock()
        self.AC, self.Z = self.alu.execute("ADD", self.AC, self.DR)
        self._print_cycle("EXECUTE", "T4", "AC ← AC + DR  |  Z ← (AC==0)",
                          self.cu.execute_signals(OP_ADD, 1))

    # ── SUB ───────────────────────────────────────────────────────────────────
    def _exec_sub(self) -> None:
        """
        SUB: AC ← AC − M[AR]
        T3: DR ← M[AR]
        T4: AC ← AC − DR,  Z ← (AC == 0)
        """
        # T3
        self.cu.next_clock()
        self.DR = self.memory.read(self.AR) & WORD_MASK
        self._print_cycle("EXECUTE", "T3", "DR ← M[AR]",
                          self.cu.execute_signals(OP_SUB, 0))

        # T4
        self.cu.next_clock()
        self.AC, self.Z = self.alu.execute("SUB", self.AC, self.DR)
        self._print_cycle("EXECUTE", "T4", "AC ← AC − DR  |  Z ← (AC==0)",
                          self.cu.execute_signals(OP_SUB, 1))

    # ── BRANCH ────────────────────────────────────────────────────────────────
    def _exec_branch(self) -> None:
        """
        BRANCH: PC ← AR  (unconditional)
        T3: PC ← AR
        """
        self.cu.next_clock()
        self.PC = self.AR & ADDR_MASK
        self._print_cycle("EXECUTE", "T3", "PC ← AR   (unconditional branch)",
                          self.cu.execute_signals(OP_BRANCH, 0))

    # ── BRANCH_IF_ZERO ────────────────────────────────────────────────────────
    def _exec_branch_if_zero(self) -> None:
        """
        BRANCH_IF_ZERO: if Z = 1 then PC ← AR
        T3: If Z=1 then PC ← AR  else NOP
        """
        self.cu.next_clock()
        taken = (self.Z == 1)
        if taken:
            self.PC = self.AR & ADDR_MASK
            rtl = "Z=1 → PC ← AR   (branch taken)"
        else:
            rtl = "Z=0 → NOP       (branch not taken)"
        self._print_cycle("EXECUTE", "T3", rtl,
                          self.cu.execute_signals(OP_BRANCH_IF_ZERO, 0, self.Z))

    # ── CLEAR ─────────────────────────────────────────────────────────────────
    def _exec_clear(self) -> None:
        """
        CLEAR: AC ← 0, Z ← 1
        T3: AC ← ALU_CLEAR = 0,  Z ← 1
        """
        self.cu.next_clock()
        self.AC, self.Z = self.alu.execute("CLEAR", 0, 0)
        self._print_cycle("EXECUTE", "T3", "AC ← 0,  Z ← 1",
                          self.cu.execute_signals(OP_CLEAR, 0))

    # ── HALT ──────────────────────────────────────────────────────────────────
    def _exec_halt(self) -> None:
        """
        HALT: Stop execution.
        T3: CPU enters halted state; no further fetch cycles occur.
        """
        self.cu.next_clock()
        self._halted = True
        self._print_cycle("EXECUTE", "T3", "CPU HALTED",
                          self.cu.execute_signals(OP_HALT, 0))

    # ──────────────────────────────────────────────────────────────────────────
    # OUTPUT / TRACE FORMATTER
    # ──────────────────────────────────────────────────────────────────────────

    def _print_cycle(
        self,
        phase   : str,
        t_label : str,
        rtl     : str,
        signals : list[str],
    ) -> None:
        """
        Print the academic-format trace for one clock cycle.

        Format
        ------
        Clock Cycle: N
        Phase      : FETCH / DECODE / EXECUTE
        Tstate     : T0  →  RTL expression
        Control Signals: sig1, sig2, …
        Registers  :
            PC = XXXX   AR = XXXX   IR = BBBB BBBB BBBB BBBB
            AC = XXXX   DR = XXXX   TR = XXXX   Z = X
        """
        ir_bin = f"{self.IR:016b}"
        ir_fmt = f"{ir_bin[0]} {ir_bin[1:4]} {ir_bin[4:8]} {ir_bin[8:12]} {ir_bin[12:]}"

        indent = "    "
        print(f"\n{'─' * 72}")
        print(f"  Clock Cycle : {self.cu.clock_cycle}")
        print(f"  Phase       : {phase}")
        print(f"  {t_label}: {rtl}")
        print(f"  Control Signals:")
        print(f"{indent}{', '.join(signals)}")
        print(f"  Registers:")
        print(f"{indent}PC = {self.PC:03X}h    "
              f"AR = {self.AR:03X}h    "
              f"IR = {ir_fmt}")
        print(f"{indent}AC = {self.AC:04X}h  ({self.AC:5d})   "
              f"DR = {self.DR:04X}h  ({self.DR:5d})   "
              f"TR = {self.TR:04X}h")
        print(f"{indent}Z  = {self.Z}")


# ──────────────────────────────────────────────────────────────────────────────
# INSTRUCTION ASSEMBLER HELPER
# Constructs 16-bit instruction words from symbolic fields
# ──────────────────────────────────────────────────────────────────────────────

def assemble(opcode: int, address: int, indirect: bool = False) -> int:
    """
    Build a 16-bit instruction word.
    Layout: | I(1) | opcode(3) | address(12) |

    Parameters
    ----------
    opcode   : 3-bit operation code (0–7)
    address  : 12-bit memory address (0–0xFFF)
    indirect : True → set I bit (bit 15)

    Returns
    -------
    16-bit integer encoding the instruction.
    """
    word  = (int(indirect) & 1)       << INDIRECT_BIT
    word |= (opcode        & 0b111)   << OPCODE_SHIFT
    word |= (address       & ADDR_MASK)
    return word & WORD_MASK


# ──────────────────────────────────────────────────────────────────────────────
# EXAMPLE PROGRAM  — Sum of integers 1 to 5
# ──────────────────────────────────────────────────────────────────────────────
#
#  High-level algorithm:
#      SUM   ← 0
#      COUNT ← 5
#      LOOP:
#          SUM   ← SUM + COUNT
#          COUNT ← COUNT − 1
#          if COUNT ≠ 0 → BRANCH to LOOP
#          else  (COUNT = 0, Z=1) → fall through
#      HALT
#
#  Memory map:
#  ┌──────┬──────────────────────────────────────────────────────┐
#  │ Addr │ Contents                                             │
#  ├──────┼──────────────────────────────────────────────────────┤
#  │ 000  │ CLEAR                   ; AC ← 0                    │
#  │ 001  │ LOAD  SUM   (020)       ; AC ← M[020] = 0           │
#  │ 002  │ ADD   COUNT (021)       ; AC ← AC + COUNT           │
#  │ 003  │ STORE SUM   (020)       ; M[020] ← AC               │
#  │ 004  │ LOAD  COUNT (021)       ; AC ← COUNT                │
#  │ 005  │ SUB   ONE   (022)       ; AC ← COUNT - 1            │
#  │ 006  │ STORE COUNT (021)       ; M[021] ← new COUNT        │
#  │ 007  │ BRANCH_IF_ZERO DONE(009); if Z=1 skip loop          │
#  │ 008  │ BRANCH LOOP (002)       ; jump back to ADD step      │
#  │ 009  │ HALT                                                 │
#  ├──────┼──────────────────────────────────────────────────────┤
#  │ 020  │ 0x0000  (SUM — accumulates result)                  │
#  │ 021  │ 0x0005  (COUNT = 5)                                  │
#  │ 022  │ 0x0001  (constant ONE  = 1)                         │
#  └──────┴──────────────────────────────────────────────────────┘
#
#  Expected result after HALT: M[020] = 15  (1+2+3+4+5)
#
# ──────────────────────────────────────────────────────────────────────────────

def build_sum_program() -> dict:
    """
    Encode the 'Sum 1 to 5' program as a dictionary {address: 16-bit word}.
    Uses the assemble() helper so every word is clearly readable.

    Address layout:
        0x000        →  CLEAR   (initialise AC)
        0x001–0x008  →  loop body (LOOP ENTRY = 0x001)
        0x009        →  HALT
        0x020        →  variable SUM   (starts at 0)
        0x021        →  variable COUNT (starts at 5)
        0x022        →  constant ONE   (= 1)

    Loop iterations (high-level):
        Iter 1: SUM = 0 + 5 = 5,  COUNT = 4
        Iter 2: SUM = 5 + 4 = 9,  COUNT = 3
        Iter 3: SUM = 9 + 3 = 12, COUNT = 2
        Iter 4: SUM = 12+ 2 = 14, COUNT = 1
        Iter 5: SUM = 14+ 1 = 15, COUNT = 0  (Z=1) → exit loop
        Result: M[020] = 15  (1+2+3+4+5)
    """

    # ── Symbolic addresses ──────────────────────────────────────────────────
    ADDR_SUM   = 0x020
    ADDR_COUNT = 0x021
    ADDR_ONE   = 0x022

    # ── Program ─────────────────────────────────────────────────────────────
    program = {
        # Instructions
        0x000: assemble(OP_CLEAR,          0x000),          # CLEAR          ; AC <- 0
        0x001: assemble(OP_LOAD,    ADDR_SUM),              # LOAD SUM       ; AC <- M[SUM]  <-- LOOP ENTRY
        0x002: assemble(OP_ADD,     ADDR_COUNT),            # ADD COUNT      ; AC <- AC + COUNT
        0x003: assemble(OP_STORE,   ADDR_SUM),              # STORE SUM      ; M[SUM] <- AC
        0x004: assemble(OP_LOAD,    ADDR_COUNT),            # LOAD COUNT     ; AC <- COUNT
        0x005: assemble(OP_SUB,     ADDR_ONE),              # SUB ONE        ; AC <- COUNT - 1
        0x006: assemble(OP_STORE,   ADDR_COUNT),            # STORE COUNT    ; M[COUNT] <- AC
        0x007: assemble(OP_BRANCH_IF_ZERO, 0x009),         # BIZ DONE       ; if Z=1 -> 009
        0x008: assemble(OP_BRANCH,  0x001),                 # BRANCH LOOP    ; jump to 001 (LOAD SUM)
        0x009: assemble(OP_HALT,    0x000),                 # HALT

        # Data section
        ADDR_SUM   : 0x0000,   # SUM   = 0 (initialised)
        ADDR_COUNT : 0x0005,   # COUNT = 5
        ADDR_ONE   : 0x0001,   # ONE   = 1 (constant)
    }
    return program


# ──────────────────────────────────────────────────────────────────────────────
# MAIN ENTRY POINT
# ──────────────────────────────────────────────────────────────────────────────

def main() -> None:
    print(SEPARATOR)
    print("  COA PROJECT — CPU INSTRUCTION FETCH–DECODE–EXECUTE SIMULATOR")
    print("  Program : Sum of integers 1 to 5  (loop + branch)")
    print("  Model   : Von Neumann | RTL Level | Clock-accurate")
    print(SEPARATOR)

    # 1. Instantiate memory and load the example program
    mem = Memory()
    mem.load_program(build_sum_program())

    # 2. Create the CPU (links to memory internally)
    cpu = CPU(mem)

    # 3. Run simulation (max_cycles guards against infinite loops in buggy programs)
    cpu.run(max_cycles=500)

    # 4. Post-execution memory verification
    print("\n  VERIFICATION — Final Data Memory Values:")
    print(f"    M[020h] (SUM)   = {mem.read(0x020):04X}h  = {mem.read(0x020)} decimal")
    print(f"    M[021h] (COUNT) = {mem.read(0x021):04X}h  = {mem.read(0x021)} decimal")
    print(f"\n  Expected: SUM = 15 (1+2+3+4+5)  |  COUNT = 0")
    result_ok = mem.read(0x020) == 15 and mem.read(0x021) == 0
    print(f"  Result   : {'[CORRECT]' if result_ok else '[MISMATCH] -- check program!'}")
    print(SEPARATOR)


if __name__ == "__main__":
    main()
