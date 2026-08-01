/**
 * Redux Toolkit store — matches the proposal's stated state-management choice (§6.4).
 * Only genuinely global state lives here: identity and role. Page data is fetched locally.
 */

import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { tokens, type Role } from './api';

interface AuthState {
  authenticated: boolean;
  email: string | null;
  role: Role | null;
  employeeId: string | null;
}

const initialState: AuthState = {
  authenticated: Boolean(tokens.access),
  email: localStorage.getItem('pulsehr.email'),
  role: localStorage.getItem('pulsehr.role') as Role | null,
  employeeId: localStorage.getItem('pulsehr.employeeId'),
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    signedIn(
      state,
      action: PayloadAction<{ email: string; role: Role; employeeId: string | null }>,
    ) {
      state.authenticated = true;
      state.email = action.payload.email;
      state.role = action.payload.role;
      state.employeeId = action.payload.employeeId;
      localStorage.setItem('pulsehr.email', action.payload.email);
      localStorage.setItem('pulsehr.role', action.payload.role);
      if (action.payload.employeeId) {
        localStorage.setItem('pulsehr.employeeId', action.payload.employeeId);
      }
    },
    signedOut(state) {
      state.authenticated = false;
      state.email = null;
      state.role = null;
      state.employeeId = null;
      tokens.clear();
      localStorage.removeItem('pulsehr.email');
      localStorage.removeItem('pulsehr.role');
      localStorage.removeItem('pulsehr.employeeId');
    },
  },
});

export const { signedIn, signedOut } = authSlice.actions;

export const store = configureStore({ reducer: { auth: authSlice.reducer } });

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
