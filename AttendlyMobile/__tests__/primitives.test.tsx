import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Button, Input, Badge, Card, Divider, MpinInput } from '../src/components/primitives';
import { MPIN_LENGTH } from '../src/components/primitives/MpinInput';
import { Text, View, TextInput } from 'react-native';

describe('Design System Primitives', () => {
  describe('MpinInput (Tactile 4-Digit Component)', () => {
    it('enforces MPIN_LENGTH === 4 and renders exactly 4 accessible digit slots', async () => {
      expect(MPIN_LENGTH).toBe(4);

      let tree: any;
      await ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(
          <MpinInput value="" onChangeText={jest.fn()} />
        );
      });

      const slots = tree.root
        .findAllByType(View)
        .filter((node: any) => node.props?.accessibilityLabel?.startsWith('Digit'));
      expect(slots).toHaveLength(4);
      expect(slots[0].props.accessibilityLabel).toBe('Digit 1 of 4');
      expect(slots[1].props.accessibilityLabel).toBe('Digit 2 of 4');
      expect(slots[2].props.accessibilityLabel).toBe('Digit 3 of 4');
      expect(slots[3].props.accessibilityLabel).toBe('Digit 4 of 4');
    });

    it('renders filled dots when masked and digits when unmasked', async () => {
      let maskedTree: any;
      await ReactTestRenderer.act(() => {
        maskedTree = ReactTestRenderer.create(
          <MpinInput value="12" onChangeText={jest.fn()} masked={true} />
        );
      });

      // Two filled slots should have dot views
      const filledSlots = maskedTree.root
        .findAllByType(View)
        .filter((node: any) => node.props?.accessibilityLabel?.includes('filled'));
      expect(filledSlots).toHaveLength(2);
      expect(filledSlots[0].props.accessibilityLabel).toBe('Digit 1 of 4 filled');
      expect(filledSlots[1].props.accessibilityLabel).toBe('Digit 2 of 4 filled');

      // Unmasked should render digit text
      let unmaskedTree: any;
      await ReactTestRenderer.act(() => {
        unmaskedTree = ReactTestRenderer.create(
          <MpinInput value="34" onChangeText={jest.fn()} masked={false} />
        );
      });
      const texts = unmaskedTree.root.findAllByType(Text);
      const digitTexts = texts.map((t: any) => t.props.children);
      expect(digitTexts).toEqual(['3', '4']);
    });

    it('filters non-numeric characters and limits input to 4 digits', async () => {
      const onChangeMock = jest.fn();
      let tree: any;
      await ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(
          <MpinInput value="" onChangeText={onChangeMock} />
        );
      });

      const hiddenInput = tree.root.findByType(TextInput);
      await ReactTestRenderer.act(() => {
        hiddenInput.props.onChangeText('1a2b3c4d5e');
      });

      // Should sanitize to exactly '1234'
      expect(onChangeMock).toHaveBeenCalledWith('1234');
    });
  });

  describe('Button', () => {
    it('renders title correctly and handles press', async () => {
      const onPressMock = jest.fn();
      let tree: any;
      await ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(
          <Button title="Save Attendance" onPress={onPressMock} />
        );
      });

      expect(tree.toJSON()).toBeTruthy();
      const text = tree.root.findByType(Text);
      expect(text.props.children).toBe('Save Attendance');

      // Trigger press
      await ReactTestRenderer.act(() => {
        tree.root.props.onPress();
      });
      expect(onPressMock).toHaveBeenCalledTimes(1);
    });

    it('renders disabled state', async () => {
      let tree: any;
      await ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(
          <Button title="Disabled Button" onPress={jest.fn()} disabled />
        );
      });
      const pressable = tree.root.findByProps({ accessibilityRole: 'button' });
      expect(pressable.props.accessibilityState.disabled).toBe(true);
    });
  });

  describe('Input', () => {
    it('renders label, placeholder, and helper text', async () => {
      let tree: any;
      await ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(
          <Input
            label="Worker Name"
            placeholder="Enter full name"
            helperText="Max 100 characters"
          />
        );
      });

      const label = tree.root.findAllByType(Text)[0];
      expect(label.props.children).toBe('Worker Name');
    });

    it('renders error message', async () => {
      let tree: any;
      await ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(
          <Input label="Daily Wage" error="Wage cannot be negative" />
        );
      });

      const texts = tree.root.findAllByType(Text);
      const errorText = texts.find((t: any) => t.props.children === 'Wage cannot be negative');
      expect(errorText).toBeTruthy();
    });
  });

  describe('Badge', () => {
    it('renders status label with variant', async () => {
      let tree: any;
      await ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<Badge label="Full Day" variant="success" />);
      });

      const text = tree.root.findByType(Text);
      expect(text.props.children).toBe('Full Day');
    });
  });

  describe('Card', () => {
    it('renders children within card surface', async () => {
      let tree: any;
      await ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(
          <Card>
            <Text>Card Surface Content</Text>
          </Card>
        );
      });

      const text = tree.root.findByType(Text);
      expect(text.props.children).toBe('Card Surface Content');
    });
  });

  describe('Divider', () => {
    it('renders without crashing', async () => {
      let tree: any;
      await ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<Divider />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });
  });
});
