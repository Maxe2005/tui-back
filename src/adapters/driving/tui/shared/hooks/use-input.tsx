// tui/shared/hooks: Ink's useInput behind an input gate. While the shell shows the too-small
// screen every mounted handler is inert, so a hidden zone or dialog cannot act on keystrokes.
import { createContext, useContext, type ReactNode } from 'react';
import { useInput as inkUseInput } from 'ink';

const InputGateContext = createContext(false);

export function InputGate({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  return <InputGateContext.Provider value={disabled}>{children}</InputGateContext.Provider>;
}

export function useInput(...[handler, options]: Parameters<typeof inkUseInput>): void {
  const disabled = useContext(InputGateContext);
  inkUseInput(handler, { ...options, isActive: (options?.isActive ?? true) && !disabled });
}
