import { type Static, Type } from "typebox";
import { Check } from "typebox/value";

const nullableString = Type.Union([Type.String(), Type.Null()]);
const nullableNumber = Type.Union([Type.Number(), Type.Null()]);
const Device = Type.Object({
	name: nullableString,
	class: nullableString,
	status: nullableString,
	errorCode: nullableNumber,
	deviceId: nullableString,
	hardwareIds: Type.Array(nullableString),
});
const PnpDevice = Type.Object({ name: nullableString, status: nullableString, errorCode: nullableNumber });
const DriverResult = Type.Object({
	devices: Type.Optional(Type.Array(Device)),
	count: Type.Optional(Type.Number()),
	removable: Type.Optional(
		Type.Array(
			Type.Object({
				model: nullableString,
				interface: nullableString,
				mediaType: nullableString,
				sizeGB: nullableNumber,
			}),
		),
	),
	net: Type.Optional(
		Type.Array(
			Type.Object({
				name: nullableString,
				connId: nullableString,
				physical: Type.Boolean(),
				connStatus: nullableNumber,
			}),
		),
	),
	bluetooth: Type.Optional(Type.Array(PnpDevice)),
	audio: Type.Optional(Type.Array(PnpDevice)),
	display: Type.Optional(
		Type.Array(
			Type.Object({
				name: nullableString,
				vendor: nullableString,
				driver: nullableString,
				status: nullableString,
				bus: nullableString,
			}),
		),
	),
	services: Type.Optional(Type.Array(Type.Object({ name: nullableString, state: nullableString }))),
	drivers: Type.Optional(
		Type.Array(
			Type.Object({
				class: nullableString,
				device: nullableString,
				version: nullableString,
				date: nullableString,
				provider: nullableString,
			}),
		),
	),
	notice: Type.Optional(Type.String()),
	error: Type.Optional(Type.String()),
	degraded: Type.Optional(Type.Boolean()),
	collectionErrors: Type.Optional(Type.Array(Type.Unknown())),
});

export type CoreResult = Static<typeof DriverResult>;
export type DeviceRow = Static<typeof Device>;

export function parseDriverResult(value: unknown): CoreResult {
	if (!Check(DriverResult, value)) throw new Error("设备查询返回结构异常");
	return value;
}
