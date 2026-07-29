// @ts-nocheck
type Props = {
  value: string
  onInput: (v: string) => void
  onSend: () => void
  disabled?: boolean
  placeholder?: string
}

export function InputBar(props: Props) {
  return (
    <div class="mafw-inputbar">
      <input
        type="text"
        value={props.value}
        onInput={e => props.onInput(e.currentTarget.value)}
        onKeyDown={e => e.key === "Enter" && props.onSend()}
        placeholder={props.placeholder || "Type a message..."}
        disabled={props.disabled}
        class="mafw-input"
      />
      <button onClick={props.onSend} disabled={props.disabled || !props.value.trim()} class="mafw-send-btn">
        ▶ Send
      </button>
    </div>
  )
}
