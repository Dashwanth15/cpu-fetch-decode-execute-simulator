# CPU Fetch–Decode–Execute Simulator

A modern **CPU instruction cycle simulator** that demonstrates how a processor executes instructions through the **Fetch → Decode → Execute cycle**.

This project was developed as part of a **Computer Organization and Architecture (COA) Project Based Learning (PBL)** to visualize how instructions move through CPU registers, memory, and control signals.

---

# Project Demo

## CPU Simulator Interface

![CPU Simulator](Screenshots/image2.png)

## Performance Analysis Dashboard

![Performance Analysis](Screenshots/image1.png)

---

# Live Hardware Simulation (Tinkercad)

You can explore the Arduino-based hardware simulation here:

https://www.tinkercad.com/things/fIGZudTB0BZ-fetch-decode-execute-instructions-in-cpu-simulation?sharecode=Ix5Jo560JJzthIOlax9oJO75jTfjxaF4RwqHS9exrMY

Open the link and click **Start Simulation**.

---

# Project Features

- Full simulation of the **CPU instruction cycle**
- Step-by-step **Fetch → Decode → Execute visualization**
- Interactive **CPU register monitoring**
- Memory visualization
- Performance analytics dashboard
- Cycle-by-cycle execution timeline
- Instruction throughput analysis
- Hardware simulation using **Arduino + Tinkercad**

---

# CPU Architecture Simulated

The simulator models a simplified **Von Neumann architecture** CPU.

| Component | Description |
|----------|-------------|
| PC | Program Counter |
| IR | Instruction Register |
| AR | Address Register |
| DR | Data Register |
| AC | Accumulator |
| TR | Temporary Register |
| Z | Zero Flag |

---

# Instruction Cycle

## 1. Fetch Stage
The CPU retrieves the next instruction from memory using the **Program Counter (PC)**.

## 2. Decode Stage
The **Control Unit** interprets the instruction stored in the **Instruction Register (IR)**.

## 3. Execute Stage
The CPU performs the required operation using registers, ALU operations, or memory access.

The cycle repeats continuously until the **HALT instruction** is reached.

---

# Performance Metrics

The simulator provides detailed analytics including:

- Total instructions executed
- Total clock cycles
- Cycles per Instruction (CPI)
- Instruction throughput
- Pipeline stage breakdown
- Instruction execution timeline

---

# Technologies Used

## Backend
Python

## Frontend
HTML  
CSS  
JavaScript  

## Simulation
Arduino  
Tinkercad Circuits  

---
## Project Structure
COA PBL
│
├── Screenshots
│ ├── image1.png
│ └── image2.png
│
├── backend
├── frontend
│
├── cpu_simulator.py
├── main.py
├── requirements.txt
│
├── err.txt
├── out.txt
├── out2.txt
├── simulation_output.txt
│
├── LICENSE
└── README.md

## Installation and Running the Project

Clone the repository

```bash
git clone https://github.com/Dashwanth15/cpu-fetch-decode-execute-simulator.git
```

Navigate to the project directory

```bash
cd cpu-fetch-decode-execute-simulator
```

Install dependencies

```bash
pip install -r requirements.txt
```

Run the simulator

```bash
python main.py
```

Open the interface in your browser

```text
http://127.0.0.1:5000
```
## Learning Outcomes

This project demonstrates key concepts from **Computer Organization and Architecture**:

- CPU instruction cycle  
- Register operations  
- Control unit signals  
- Memory addressing  
- Performance analysis of instruction execution  
- Hardware simulation integration  

---

## Author

**Dashwanth Madduri**

B.Tech Computer Science Engineering  
Woxsen University  

GitHub  
https://github.com/Dashwanth15

---

## License

This project is released under the **MIT License**.


```bash
git clone https://github.com/Dashwanth15/cpu-fetch-decode-execute-simulator.git
