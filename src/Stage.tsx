import {ReactElement} from "react";
import {StageBase, StageResponse, InitialData, Message} from "@chub-ai/stages-ts";
import {LoadResponse} from "@chub-ai/stages-ts/dist/types/load";

type Investigator = {
  id: string;
  name: string;

  hp: number;
  hpMax: number;

  mp: number;
  mpMax: number;

  san: number;
  sanMax: number;

  luck: number;

  temporaryInsanity: string;
  indefiniteInsanity: string;
  majorWound: boolean;

  inventoryText: string;
  cluesText: string;
};

type MessageStateType = {
  investigators: Investigator[];
  activeInvestigatorId: string | null;
};

type ConfigType = {
  sendStatusToPrompt?: boolean;
};

type InitStateType = null;
type ChatStateType = null;

const defaultInvestigator: Investigator = {
  id: "investigator-1",
  name: "Investigator",

  hp: 10,
  hpMax: 10,

  mp: 10,
  mpMax: 10,

  san: 50,
  sanMax: 99,

  luck: 50,

  temporaryInsanity: "",
  indefiniteInsanity: "",
  majorWound: false,

  inventoryText: "",
  cluesText: "",
};

const defaultState: MessageStateType = {
  investigators: [defaultInvestigator],
  activeInvestigatorId: "investigator-1",
};

function clampNumber(value: number, min: number, max?: number): number {
  if (Number.isNaN(value)) return min;
  if (max == null) return Math.max(min, value);
  return Math.min(max, Math.max(min, value));
}

function buildStageDirections(state: MessageStateType): string {
  const active =
    state.investigators.find((i) => i.id === state.activeInvestigatorId) ??
    state.investigators[0];

  if (!active) {
    return "";
  }

  return `
[CoC Status Board]

Active investigator:
${active.name}

Current values:
HP: ${active.hp}/${active.hpMax}
MP: ${active.mp}/${active.mpMax}
SAN: ${active.san}/${active.sanMax}
Luck: ${active.luck}
Major wound: ${active.majorWound ? "yes" : "no"}
Temporary insanity: ${active.temporaryInsanity || "none"}
Indefinite insanity: ${active.indefiniteInsanity || "none"}

Inventory:
${active.inventoryText || "none"}

Clues:
${active.cluesText || "none"}

Rules for the assistant:
- Treat these values as user-managed reference data.
- Do not change HP, MP, SAN, Luck, inventory, or clues unless the user explicitly says they changed.
- Do not roll dice.
- Do not decide success or failure unless the user provides the result.
`;
}

function NumberInput(props: {
  label: string;
  value: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const { label, value, max, onChange } = props;

  return (
    <div style={styles.statRow}>
      <label style={styles.statLabel}>{label}</label>

      <button
        style={styles.smallButton}
        onClick={() => onChange(clampNumber(value - 1, 0, max))}
      >
        -
      </button>

      <input
        style={styles.numberInput}
        type="number"
        value={value}
        onChange={(e) => onChange(clampNumber(Number(e.target.value), 0, max))}
      />

      {max != null && <span style={styles.slash}>/</span>}

      {max != null && (
        <input
          style={styles.numberInput}
          type="number"
          value={max}
          onChange={() => {
            // max側はここでは変更しない。
            // 必要なら次版で max 編集も追加する。
          }}
          readOnly
        />
      )}

      <button
        style={styles.smallButton}
        onClick={() => onChange(clampNumber(value + 1, 0, max))}
      >
        +
      </button>
    </div>
  );
}

export class Stage extends StageBase {
  state: MessageStateType;
  config: ConfigType;

  constructor(
    data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>
  ) {
    super(data);

    this.config = data.config ?? {};
    this.state = data.messageState ?? defaultState;
  }

  async load(): Promise<LoadResponse<InitStateType, ChatStateType>> {
    return {
      success: true,
      error: null,
      initState: null,
      chatState: null,
    };
  }

  async setState(state: MessageStateType): Promise<void> {
    if (state != null) {
      this.state = {
        ...this.state,
        ...state,
      };
    }
  }

  async beforePrompt(
    _userMessage: Message
  ): Promise<StageResponse<ChatStateType, MessageStateType>> {
    const sendStatusToPrompt = this.config.sendStatusToPrompt ?? true;

    return {
      stageDirections: sendStatusToPrompt
        ? buildStageDirections(this.state)
        : null,
      messageState: this.state,
      modifiedMessage: null,
      systemMessage: null,
      error: null,
      chatState: null,
    };
  }

  async afterResponse(
    _botMessage: Message
  ): Promise<StageResponse<ChatStateType, MessageStateType>> {
    return {
      stageDirections: null,
      messageState: this.state,
      modifiedMessage: null,
      systemMessage: null,
      error: null,
      chatState: null,
    };
  }

  updateActiveInvestigator(patch: Partial<Investigator>) {
    const activeId = this.state.activeInvestigatorId;

    this.state = {
      ...this.state,
      investigators: this.state.investigators.map((inv) =>
        inv.id === activeId ? { ...inv, ...patch } : inv
      ),
    };
  }

  render(): ReactElement {
    const active =
      this.state.investigators.find(
        (i) => i.id === this.state.activeInvestigatorId
      ) ?? this.state.investigators[0];

    if (!active) {
      return (
        <div style={styles.container}>
          <h2 style={styles.title}>CoC Status Board</h2>
          <p>No investigator.</p>
        </div>
      );
    }

    return (
      <div style={styles.container}>
        <h2 style={styles.title}>CoC Status Board</h2>

        <section style={styles.card}>
          <label style={styles.label}>探索者名</label>
          <input
            style={styles.textInput}
            value={active.name}
            onChange={(e) =>
              this.updateActiveInvestigator({ name: e.target.value })
            }
          />
        </section>

        <section style={styles.card}>
          <h3 style={styles.heading}>数値</h3>

          <NumberInput
            label="HP"
            value={active.hp}
            max={active.hpMax}
            onChange={(hp) => this.updateActiveInvestigator({ hp })}
          />

          <NumberInput
            label="MP"
            value={active.mp}
            max={active.mpMax}
            onChange={(mp) => this.updateActiveInvestigator({ mp })}
          />

          <NumberInput
            label="SAN"
            value={active.san}
            max={active.sanMax}
            onChange={(san) => this.updateActiveInvestigator({ san })}
          />

          <NumberInput
            label="幸運"
            value={active.luck}
            onChange={(luck) => this.updateActiveInvestigator({ luck })}
          />
        </section>

        <section style={styles.card}>
          <h3 style={styles.heading}>状態</h3>

          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={active.majorWound}
              onChange={(e) =>
                this.updateActiveInvestigator({
                  majorWound: e.target.checked,
                })
              }
            />
            重傷
          </label>

          <label style={styles.label}>一時的狂気</label>
          <input
            style={styles.textInput}
            value={active.temporaryInsanity}
            onChange={(e) =>
              this.updateActiveInvestigator({
                temporaryInsanity: e.target.value,
              })
            }
            placeholder="なし"
          />

          <label style={styles.label}>不定の狂気</label>
          <input
            style={styles.textInput}
            value={active.indefiniteInsanity}
            onChange={(e) =>
              this.updateActiveInvestigator({
                indefiniteInsanity: e.target.value,
              })
            }
            placeholder="なし"
          />
        </section>

        <section style={styles.card}>
          <h3 style={styles.heading}>所持品</h3>
          <textarea
            style={styles.textArea}
            value={active.inventoryText}
            onChange={(e) =>
              this.updateActiveInvestigator({
                inventoryText: e.target.value,
              })
            }
            placeholder={"懐中電灯\n財布\n鍵"}
          />
        </section>

        <section style={styles.card}>
          <h3 style={styles.heading}>手掛かり</h3>
          <textarea
            style={styles.textArea}
            value={active.cluesText}
            onChange={(e) =>
              this.updateActiveInvestigator({
                cluesText: e.target.value,
              })
            }
            placeholder={"古い新聞記事\n海藻臭い泥"}
          />
        </section>
      </div>
    );
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: "100%",
    padding: "12px",
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: "#e8e0d4",
    background: "#171313",
  },

  title: {
    margin: "0 0 12px",
    fontSize: "20px",
    letterSpacing: "0.04em",
  },

  card: {
    marginBottom: "12px",
    padding: "10px",
    border: "1px solid rgba(232, 224, 212, 0.18)",
    borderRadius: "10px",
    background: "rgba(255, 255, 255, 0.04)",
  },

  heading: {
    margin: "0 0 8px",
    fontSize: "15px",
  },

  label: {
    display: "block",
    margin: "8px 0 4px",
    fontSize: "12px",
    opacity: 0.85,
  },

  statRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginBottom: "8px",
  },

  statLabel: {
    width: "42px",
    fontWeight: 700,
  },

  smallButton: {
    width: "28px",
    height: "28px",
    borderRadius: "8px",
    border: "1px solid rgba(232, 224, 212, 0.25)",
    background: "rgba(255, 255, 255, 0.08)",
    color: "#e8e0d4",
    cursor: "pointer",
  },

  numberInput: {
    width: "54px",
    padding: "5px",
    borderRadius: "8px",
    border: "1px solid rgba(232, 224, 212, 0.25)",
    background: "#221c1c",
    color: "#e8e0d4",
  },

  slash: {
    opacity: 0.7,
  },

  textInput: {
    boxSizing: "border-box",
    width: "100%",
    padding: "7px",
    borderRadius: "8px",
    border: "1px solid rgba(232, 224, 212, 0.25)",
    background: "#221c1c",
    color: "#e8e0d4",
  },

  textArea: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: "84px",
    padding: "7px",
    borderRadius: "8px",
    border: "1px solid rgba(232, 224, 212, 0.25)",
    background: "#221c1c",
    color: "#e8e0d4",
    resize: "vertical",
  },

  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginBottom: "8px",
  },
};
