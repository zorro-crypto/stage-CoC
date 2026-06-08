import {ReactElement, useEffect, useState} from "react";
import {DEFAULT_INITIAL, DEFAULT_LOAD_RESPONSE, DEFAULT_RESPONSE, InitialData, StageBase} from "@chub-ai/stages-ts";

type ChubRunnerProps<StageType extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType>, InitStateType, ChatStateType, MessageStateType, ConfigType> = {
  factory: (data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) => StageType;
};

const init = "INIT";
const before = "BEFORE";
const after = "AFTER";
const set = "SET";

function canAcceptMessage(event: MessageEvent): boolean {
  if (event.source !== window.parent) {
    return false;
  }

  if (window.parent === window) {
    return true;
  }

  try {
    const origin = new URL(event.origin);
    return origin.hostname === "localhost" || origin.hostname === "127.0.0.1" || origin.hostname.endsWith("chub.ai");
  } catch {
    return event.origin === "file://" || event.origin.startsWith("capacitor://");
  }
}

export function ChubRunner<StageType extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType>, InitStateType, ChatStateType, MessageStateType, ConfigType>({
  factory,
}: ChubRunnerProps<StageType, InitStateType, ChatStateType, MessageStateType, ConfigType>): ReactElement {
  const [stage, setStage] = useState<StageType>(() => factory({...DEFAULT_INITIAL} as InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>));
  const [node, setNode] = useState(new Date());
  const [previous, setPrevious] = useState<{key: string; value: unknown}>({key: "", value: {}});

  function sendMessage(messageType: string, message: unknown): void {
    window.parent.postMessage({messageType, data: message}, "*");
  }

  useEffect(() => {
    async function handleMessage(event: MessageEvent): Promise<void> {
      try {
        if (!canAcceptMessage(event)) {
          return;
        }

        const {messageType, data} = event.data ?? {};
        const answerKey = `${messageType}: ${JSON.stringify(data)}`;

        if (previous.key === answerKey) {
          sendMessage(messageType, previous.value);
          return;
        }

        if (messageType === init) {
          const nextStage = factory({...DEFAULT_INITIAL, ...data});
          const loaded = await nextStage.load();
          const response = {...DEFAULT_LOAD_RESPONSE, ...loaded};
          setPrevious({key: answerKey, value: response});
          sendMessage(init, response);
          setStage(nextStage);
          return;
        }

        if (messageType === before) {
          const response = {...DEFAULT_RESPONSE, ...(await stage.beforePrompt({...data}))};
          setPrevious({key: answerKey, value: response});
          sendMessage(before, response);
          return;
        }

        if (messageType === after) {
          const response = {...DEFAULT_RESPONSE, ...(await stage.afterResponse({...data}))};
          setPrevious({key: answerKey, value: response});
          sendMessage(after, response);
          return;
        }

        if (messageType === set) {
          await stage.setState(data);
          setPrevious({key: answerKey, value: {}});
          sendMessage(set, {});
        }
      } catch (exception) {
        const error = exception instanceof Error ? exception : new Error(String(exception));
        window.parent.postMessage({
          messageType: "ERROR",
          data: {
            name: error.name,
            message: error.message,
            stack: error.stack,
          },
        }, "*");
      } finally {
        setNode(new Date());
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [factory, previous, stage]);

  return (
    <>
      <div style={{display: "none"}}>{String(node)}{window.location.href}</div>
      {stage.render()}
    </>
  );
}
