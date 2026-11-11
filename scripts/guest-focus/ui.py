#!/usr/bin/env python3
"""Operate the real packaged UI through guest-only, owner-authorized System Events."""
import argparse
import json
import subprocess
from pathlib import Path
import provision

SCRIPT = '''on run argv
set actionName to item 1 of argv
tell application "System Events"
  tell process "pomotroid"
    set frontmost to true
    set nodes to entire contents of front window
    if actionName is "dump" then
      set output to ""
      repeat with n in nodes
        try
          set nodeRole to role of n as text
          if nodeRole is "AXTextField" or nodeRole is "AXSecureTextField" then
            set output to output & nodeRole & " | [input omitted]" & linefeed
          else
            set output to output & nodeRole & " | " & (name of n as text) & " | " & (value of n as text) & linefeed
          end if
        end try
      end repeat
      return output
    end if
    if actionName is "click" then
      set matches to {}
      repeat with n in nodes
        try
          if (role of n is in {"AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton"}) and name of n is item 2 of argv then
            set end of matches to contents of n
          end if
        end try
      end repeat
      if (count of argv) is 3 then
        set occurrence to item 3 of argv as integer
        if occurrence < 1 or occurrence > (count of matches) then error "Control occurrence out of range"
        click item occurrence of matches
        return "clicked explicit occurrence " & occurrence
      end if
      if (count of matches) is 1 then
        click item 1 of matches
        return "clicked " & item 2 of argv
      end if
      if (count of matches) > 1 then error "Ambiguous named control: " & item 2 of argv
      error "Named control not found: " & item 2 of argv
    end if
    if actionName is "set" then
      set targetRole to item 2 of argv
      set targetIndex to item 3 of argv as integer
      set found to 0
      repeat with n in nodes
        if role of n is targetRole then
          set found to found + 1
          if found is targetIndex then
            if targetRole is "AXTextField" then
              click n
              keystroke "a" using command down
              keystroke (item 4 of argv)
            else
              set value of n to item 4 of argv
            end if
            return "set " & targetRole
          end if
        end if
      end repeat
      error "Field not found"
    end if
    if actionName is "key" then
      key code (item 2 of argv as integer)
      return "key sent"
    end if
    error "Unknown action"
  end tell
end tell
end run
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--process', choices=('pomotroid', 'zen', 'Discord'), default='pomotroid')
    parser.add_argument('action', choices=('dump', 'click', 'set', 'key'))
    parser.add_argument('arguments', nargs='*')
    args = parser.parse_args()
    provision.guard_guest(args.run_id)
    if args.action == 'set' and args.arguments and args.arguments[0] == 'AXSecureTextField':
        raise ValueError('credential fields require user control')
    script = SCRIPT.replace('tell process "pomotroid"', 'tell process "' + args.process + '"')
    result = subprocess.run(['/usr/bin/osascript', '-e', script, args.action, *args.arguments], capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise RuntimeError('Guest UI automation unavailable: ' + result.stderr.strip())
    print(result.stdout.strip())


if __name__ == '__main__':
    main()
