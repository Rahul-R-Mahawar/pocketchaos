import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { makeEndpoint, makeFakeApi, PROJECT_KEY, renderWithProviders } from '../test/fixtures';
import { EndpointForm } from './EndpointForm';

function renderForm(api = makeFakeApi()) {
  const onCreated = vi.fn();
  const rendered = renderWithProviders(<EndpointForm projectKey={PROJECT_KEY} onCreated={onCreated} />, { api });
  return { ...rendered, onCreated, user: userEvent.setup() };
}

/** Typing JSON with user-event needs brace escaping; replacing the value directly is clearer. */
function setMock(json: string) {
  fireEvent.change(screen.getByLabelText(/mock response json/i), { target: { value: json } });
}

describe('EndpointForm', () => {
  it('shows the proxy prefix for the path', () => {
    renderForm();
    expect(screen.getByText(`/proxy/${PROJECT_KEY}`)).toBeInTheDocument();
  });

  it('blocks submission and explains every invalid field', async () => {
    const { api, user } = renderForm();
    await user.clear(screen.getByLabelText('Path'));
    await user.type(screen.getByLabelText('Path'), 'no-slash');
    setMock('{"broken": ');
    await user.click(screen.getByRole('button', { name: /create endpoint/i }));

    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Path must start with "/"')).toBeInTheDocument();
    expect(screen.getByText(/^Invalid JSON/)).toBeInTheDocument();
    expect(api.createEndpoint).not.toHaveBeenCalled();
  });

  it('creates a mock endpoint, sending the mock as parsed JSON and no empty targetUrl', async () => {
    const created = makeEndpoint({ name: 'Orders', method: 'POST', path: '/orders' });
    const api = makeFakeApi({ createEndpoint: vi.fn().mockResolvedValue(created) });
    const { onCreated, user } = renderForm(api);

    await user.type(screen.getByLabelText('Name'), 'Orders');
    await user.selectOptions(screen.getByLabelText('Method'), 'POST');
    await user.clear(screen.getByLabelText('Path'));
    await user.type(screen.getByLabelText('Path'), '/orders');
    setMock('{"orderId": 7, "items": [1, 2]}');
    await user.click(screen.getByRole('button', { name: /create endpoint/i }));

    expect(api.createEndpoint).toHaveBeenCalledWith({
      name: 'Orders',
      method: 'POST',
      path: '/orders',
      mockResponseJson: { orderId: 7, items: [1, 2] },
    });
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(await screen.findByRole('status')).toHaveTextContent('Created POST /orders');
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('includes a target URL for forward endpoints', async () => {
    const api = makeFakeApi({ createEndpoint: vi.fn().mockResolvedValue(makeEndpoint({ mode: 'forward' })) });
    const { user } = renderForm(api);
    await user.type(screen.getByLabelText('Name'), 'Todo');
    await user.type(screen.getByLabelText(/target url/i), 'https://jsonplaceholder.typicode.com/todos/1');
    await user.click(screen.getByRole('button', { name: /create endpoint/i }));
    expect(api.createEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ targetUrl: 'https://jsonplaceholder.typicode.com/todos/1' }),
    );
  });

  it('warns about local targets before the server does', async () => {
    const { api, user } = renderForm();
    await user.type(screen.getByLabelText('Name'), 'Local');
    await user.type(screen.getByLabelText(/target url/i), 'http://localhost:8080/api');
    await user.click(screen.getByRole('button', { name: /create endpoint/i }));
    expect(screen.getByText(/blocked by the proxy SSRF guard/)).toBeInTheDocument();
    expect(api.createEndpoint).not.toHaveBeenCalled();
  });

  it('shows server-side field errors (e.g. the SSRF guard) under the right field', async () => {
    const api = makeFakeApi({
      createEndpoint: vi.fn().mockRejectedValue(
        new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', [
          { location: 'body', path: 'targetUrl', message: 'targetUrl rejected: hostname "intranet.example.com" resolves to a private or reserved address' },
        ]),
      ),
    });
    const { user } = renderForm(api);
    await user.type(screen.getByLabelText('Name'), 'Intranet');
    await user.type(screen.getByLabelText(/target url/i), 'https://intranet.example.com/api');
    await user.click(screen.getByRole('button', { name: /create endpoint/i }));
    expect(await screen.findByText(/resolves to a private or reserved address/)).toBeInTheDocument();
    expect(screen.getByLabelText(/target url/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows non-field errors such as a duplicate route', async () => {
    const api = makeFakeApi({
      createEndpoint: vi
        .fn()
        .mockRejectedValue(new ApiError(409, 'ENDPOINT_EXISTS', 'An endpoint for GET /users/profile already exists')),
    });
    const { user } = renderForm(api);
    await user.type(screen.getByLabelText('Name'), 'Dup');
    await user.click(screen.getByRole('button', { name: /create endpoint/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });

  it('formats the mock JSON', async () => {
    const { user } = renderForm();
    setMock('{"a":1,"b":[true,null]}');
    await user.click(screen.getByRole('button', { name: 'Format' }));
    expect(screen.getByLabelText(/mock response json/i)).toHaveValue('{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}');
  });
});
