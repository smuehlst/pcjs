CA65 = ca65
LD65 = ld65
ECHO = @/bin/echo

CA65_OPTS =
LD65_OPTS = --target none

all: bcd.65v

bcd.obj: bcd.asm
	$(CA65) bcd.asm -I ../.. -l -o bcd.obj

bcd.bin: bcd.obj
	$(LD65) $(LD65_OPTS) $+ -o $@

bcd.65v: bcd.bin
	$(ECHO) -n ".0200/" > bcd.65v
	hexdump -e '1/1 "%02X\n"' -v bcd.bin >> bcd.65v
	$(ECHO) -n ".0200G" >> bcd.65v
