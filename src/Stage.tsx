import {ReactElement, useMemo, useState} from "react";
import {InitialData, Message, StageBase, StageResponse} from "@chub-ai/stages-ts";
import {LoadResponse} from "@chub-ai/stages-ts/dist/types/load";

type Investigator = {
  id: string;
  name: string;
  hp: number;
  mp: number;
  san: number;
  luck: number;
  majorWound: boolean;
  temporaryInsanity: string;
  indefiniteInsanity: string;
  inventory: string;
  clues: string;
};

type MessageStateType = {
  investigators: Investigator[];
};

type ConfigType = {
  sendStatusToPrompt?: boolean;
};

type InitStateType = null;
type ChatStateType = MessageStateType;

const storageKey = "chub-coc-stage-state-v1";

const createInvestigator = (name = ""): Investigator => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  name,
  hp: 10,
  mp: 10,
  san: 50,
  luck: 50,
  majorWound: false,
  temporaryInsanity: "",
  indefiniteInsanity: "",
  inventory: "",
  clues: "",
});

const defaultState = (): MessageStateType => ({
  investigators: [createInvestigator("探索者 1")],
});

function normalizeNumber(value: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function normalizeState(state: MessageStateType | null | undefined): MessageStateType {
  if (!state?.investigators?.length) {
    return defaultState();
  }

  return {
    investigators: state.investigators.map((investigator, index) => ({
      ...createInvestigator(`探索者 ${index + 1}`),
      ...investigator,
      hp: normalizeNumber(investigator.hp),
      mp: normalizeNumber(investigator.mp),
      san: normalizeNumber(investigator.san),
      luck: normalizeNumber(investigator.luck),
      majorWound: Boolean(investigator.majorWound),
      temporaryInsanity: investigator.temporaryInsanity ?? "",
      indefiniteInsanity: investigator.indefiniteInsanity ?? "",
      inventory: investigator.inventory ?? "",
      clues: investigator.clues ?? "",
    })),
  };
}

function loadStoredState(): MessageStateType | null {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored == null ? null : normalizeState(JSON.parse(stored));
  } catch {
    return null;
  }
}

function saveStoredState(state: MessageStateType): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Chub also stores message state when a chat turn is sent.
  }
}

function buildStageDirections(state: MessageStateType): string {
  const lines = state.investigators.map((investigator) => {
    return [
      `名前: ${investigator.name || "未設定"}`,
      `HP: ${investigator.hp}`,
      `MP: ${investigator.mp}`,
      `SAN: ${investigator.san}`,
      `幸運: ${investigator.luck}`,
      `重傷: ${investigator.majorWound ? "あり" : "なし"}`,
      `一時的狂気: ${investigator.temporaryInsanity || "なし"}`,
      `不定の狂気: ${investigator.indefiniteInsanity || "なし"}`,
      `所持品: ${investigator.inventory || "なし"}`,
      `手掛かり: ${investigator.clues || "なし"}`,
    ].join("\n");
  });

  return [
    "[CoC 探索者管理]",
    "以下はユーザーが手動管理している探索者情報です。ユーザーが明示しない限り、数値やメモを勝手に変更したものとして扱わないでください。",
    "",
    lines.join("\n\n"),
  ].join("\n");
}

type CocKeeperProps = {
  initialState: MessageStateType;
  onChange: (state: MessageStateType) => void;
  onSave: (state: MessageStateType) => void;
};

function CocKeeper({initialState, onChange, onSave}: CocKeeperProps): ReactElement {
  const [state, setState] = useState<MessageStateType>(initialState);
  const investigators = state.investigators;

  const summary = useMemo(() => {
    const wounded = investigators.filter((investigator) => investigator.majorWound).length;
    const clueLines = investigators.reduce((count, investigator) => {
      return count + investigator.clues.split("\n").filter((line) => line.trim() !== "").length;
    }, 0);

    return {wounded, clueLines};
  }, [investigators]);

  function commit(nextState: MessageStateType): void {
    const normalized = normalizeState(nextState);
    setState(normalized);
    onChange(normalized);
    onSave(normalized);
    saveStoredState(normalized);
  }

  function updateInvestigator(id: string, update: Partial<Investigator>): void {
    commit({
      investigators: investigators.map((investigator) => {
        if (investigator.id !== id) {
          return investigator;
        }

        return {...investigator, ...update};
      }),
    });
  }

  function changeValue(id: string, key: "hp" | "mp" | "san" | "luck", amount: number): void {
    const target = investigators.find((investigator) => investigator.id === id);
    if (target == null) {
      return;
    }

    updateInvestigator(id, {[key]: normalizeNumber(target[key] + amount)});
  }

  function addInvestigator(): void {
    commit({
      investigators: [...investigators, createInvestigator(`探索者 ${investigators.length + 1}`)],
    });
  }

  function removeInvestigator(id: string): void {
    if (investigators.length <= 1) {
      return;
    }

    commit({
      investigators: investigators.filter((investigator) => investigator.id !== id),
    });
  }

  return (
    <main className="coc-stage">
      <header className="coc-stage__header">
        <div>
          <p className="coc-stage__eyebrow">Call of Cthulhu</p>
          <h1>探索者管理</h1>
        </div>
        <button className="coc-button coc-button--primary" onClick={addInvestigator} type="button">
          + 探索者
        </button>
      </header>

      <section className="coc-summary" aria-label="概要">
        <span>{investigators.length}人</span>
        <span>重傷 {summary.wounded}</span>
        <span>手掛かり {summary.clueLines}</span>
      </section>

      <section className="coc-list" aria-label="探索者一覧">
        {investigators.map((investigator) => (
          <article className="investigator" key={investigator.id}>
            <div className="investigator__top">
              <input
                aria-label="探索者名"
                className="investigator__name"
                onChange={(event) => updateInvestigator(investigator.id, {name: event.target.value})}
                placeholder="探索者名"
                type="text"
                value={investigator.name}
              />
              <button
                className="coc-button coc-button--ghost"
                disabled={investigators.length <= 1}
                onClick={() => removeInvestigator(investigator.id)}
                type="button"
              >
                削除
              </button>
            </div>

            <div className="stat-grid">
              <StatControl
                label="HP"
                onChange={(value) => updateInvestigator(investigator.id, {hp: value})}
                onStep={(amount) => changeValue(investigator.id, "hp", amount)}
                value={investigator.hp}
              />
              <StatControl
                label="MP"
                onChange={(value) => updateInvestigator(investigator.id, {mp: value})}
                onStep={(amount) => changeValue(investigator.id, "mp", amount)}
                value={investigator.mp}
              />
              <StatControl
                label="SAN"
                onChange={(value) => updateInvestigator(investigator.id, {san: value})}
                onStep={(amount) => changeValue(investigator.id, "san", amount)}
                value={investigator.san}
              />
              <StatControl
                label="幸運"
                onChange={(value) => updateInvestigator(investigator.id, {luck: value})}
                onStep={(amount) => changeValue(investigator.id, "luck", amount)}
                value={investigator.luck}
              />
            </div>

            <label className="major-wound">
              <input
                checked={investigator.majorWound}
                onChange={(event) => updateInvestigator(investigator.id, {majorWound: event.target.checked})}
                type="checkbox"
              />
              <span>重傷</span>
            </label>

            <div className="memo-grid">
              <MemoField
                label="一時的狂気"
                onChange={(temporaryInsanity) => updateInvestigator(investigator.id, {temporaryInsanity})}
                value={investigator.temporaryInsanity}
              />
              <MemoField
                label="不定の狂気"
                onChange={(indefiniteInsanity) => updateInvestigator(investigator.id, {indefiniteInsanity})}
                value={investigator.indefiniteInsanity}
              />
              <MemoField
                label="所持品"
                onChange={(inventory) => updateInvestigator(investigator.id, {inventory})}
                value={investigator.inventory}
              />
              <MemoField
                label="手掛かり"
                onChange={(clues) => updateInvestigator(investigator.id, {clues})}
                value={investigator.clues}
              />
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

type StatControlProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onStep: (amount: number) => void;
};

function StatControl({label, value, onChange, onStep}: StatControlProps): ReactElement {
  return (
    <div className="stat-control">
      <span className="stat-control__label">{label}</span>
      <div className="stat-control__row">
        <button aria-label={`${label}を1減らす`} onClick={() => onStep(-1)} type="button">
          -
        </button>
        <input
          aria-label={label}
          inputMode="numeric"
          onChange={(event) => onChange(normalizeNumber(Number(event.target.value)))}
          type="number"
          value={value}
        />
        <button aria-label={`${label}を1増やす`} onClick={() => onStep(1)} type="button">
          +
        </button>
      </div>
    </div>
  );
}

type MemoFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

function MemoField({label, value, onChange}: MemoFieldProps): ReactElement {
  return (
    <label className="memo-field">
      <span>{label}</span>
      <textarea onChange={(event) => onChange(event.target.value)} rows={3} value={value} />
    </label>
  );
}

export class Stage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {
  private myInternalState: MessageStateType;
  private config: ConfigType;

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    this.config = data.config ?? {};
    this.myInternalState = normalizeState(data.chatState ?? data.messageState ?? loadStoredState());
  }

  async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {
    return {
      success: true,
      error: null,
      initState: null,
      chatState: null,
      messageState: null,
    };
  }

  async setState(state: MessageStateType): Promise<void> {
    if (state == null) {
      return;
    }

    this.myInternalState = normalizeState(state);
    saveStoredState(this.myInternalState);
  }

  async beforePrompt(_userMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return this.persist(this.config.sendStatusToPrompt ?? true);
  }

  async afterResponse(_botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return this.persist(false);
  }

  render(): ReactElement {
    return (
      <CocKeeper
        key={JSON.stringify(this.myInternalState)}
        initialState={this.myInternalState}
        onChange={(state) => {
          this.myInternalState = state;
        }}
        onSave={(state) => {
          this.saveChatState(state);
        }}
      />
    );
  }

  private saveChatState(state: MessageStateType): void {
    this.messenger.updateChatState(state).catch((error) => {
      console.warn("Failed to save CoC stage chat state.", error);
    });
  }

  private persist(sendStatusToPrompt: boolean): Partial<StageResponse<ChatStateType, MessageStateType>> {
    saveStoredState(this.myInternalState);

    return {
      stageDirections: sendStatusToPrompt ? buildStageDirections(this.myInternalState) : null,
      messageState: null,
      modifiedMessage: null,
      systemMessage: null,
      error: null,
      chatState: null,
    };
  }
}
